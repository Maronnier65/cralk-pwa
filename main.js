/*
 * main.js – CRALK PWA v6
 *
 * This script implements a camera‑first recording interface that allows users
 * to capture video from the device camera while recording either the
 * microphone or a selected music track. The recording follows a fixed
 * protocol: the first few seconds capture ambient sound from the mic,
 * followed by a countdown and then the selected song replaces the mic in
 * the recorded audio. During recording, a toggle button lets the user
 * switch which source (mic or song) is written to the video without
 * interrupting playback. Up to ten recordings are retained in a gallery
 * accessible via a horizontal swipe. A timer shows the total length of
 * the selected song and counts down the remaining time during playback.
 */

(function () {
  // ----- Element references -----
  const fileInput = document.getElementById('file-input');
  const fileInfo = document.getElementById('file-info');
  const songTimer = document.getElementById('song-timer');
  const countdownOverlay = document.getElementById('countdown-overlay');
  const audioPlayer = document.getElementById('audio-player');
  const cameraPreview = document.getElementById('camera-preview');
  const switchCameraBtn = document.getElementById('switch-camera');
  const recordButton = document.getElementById('record-button');
  const toggleSourceBtn = document.getElementById('toggle-source');
  const recordingsContainer = document.getElementById('gallery-recordings');
  const appContainer = document.getElementById('app-container');
  // Icons inside the toggle button
  const micIcon = toggleSourceBtn.querySelector('.mic-icon');
  const noteToggleIcon = toggleSourceBtn.querySelector('.note-toggle-icon');
  // Gallery control buttons
  const deleteAllBtn = document.getElementById('delete-all');
  const downloadAllBtn = document.getElementById('download-all');
  const helpBtn = document.getElementById('help-btn');

  // ----- State variables -----
  let cameraStream = null;            // MediaStream from getUserMedia (video+mic)
  let currentFacing = 'environment';  // Which camera to use (rear by default)
  let isRecording = false;            // Are we currently recording?
  let mediaRecorder = null;           // MediaRecorder instance
  let recordedChunks = [];            // Buffers for the current recording
  let audioContext = null;            // Web Audio context
  let microSource, songSource;        // MediaStreamSource nodes
  let microGain, songGain;            // Gain nodes for cross‑fading
  let destinationNode = null;         // MediaStreamDestination for combined audio
  let timerInterval = null;           // Interval to update the song timer
  let recordingStartTime = null;      // Timestamp when recording began
  let selectedFileName = '';          // Name of the chosen audio file

  // Track whether the song is currently playing to toggle the timer between
  // total duration and remaining time
  let songPlaying = false;

  // Track which source is currently being recorded ('song' or 'mic'). This
  // avoids relying on gain values directly when toggling.
  let recordingSource = 'mic';

  // Clone of the audio element used solely for recording. Creating a new
  // MediaElementSourceNode from the original audio element more than once
  // can cause errors on some browsers (notably Safari). Instead, we create
  // a fresh Audio element for each recording and feed it into the audio
  // context. This element is not part of the DOM.
  let songClone = null;

  // ----- Utility functions -----
  /**
   * Format a duration in seconds as MM:SS.
   * @param {number} seconds
   * @returns {string}
   */
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Update the song timer display. Shows remaining time / total time.
   */
  function updateSongTimer() {
    if (!audioPlayer.duration || isNaN(audioPlayer.duration)) {
      songTimer.style.display = 'none';
      return;
    }
    let text;
    // When the song is not yet playing, show its total duration. When playing,
    // display the remaining time as a countdown.
    if (!songPlaying) {
      text = formatTime(audioPlayer.duration);
    } else {
      const remaining = Math.max(0, audioPlayer.duration - audioPlayer.currentTime);
      text = formatTime(remaining);
    }
    songTimer.textContent = text;
    songTimer.style.display = 'block';
  }

  /**
   * Initialise the camera stream based on the current facing mode.
   */
  /**
   * Initialise la caméra et, si nécessaire, le micro. Pour conserver
   * l'autorisation de l'utilisateur, nous ne stoppons plus les pistes
   * existantes sauf lorsque nous devons absolument recréer le flux (par
   * exemple lors d'un changement de caméra). Le paramètre `force`
   * indique si l'on doit demander un nouveau MediaStream.
   * @param {boolean} force
   */
  async function initCamera(force = false) {
    try {
      // Si un flux existe déjà et que l'on ne force pas, réutilise-le
      if (cameraStream && !force) {
        cameraPreview.srcObject = cameraStream;
        return;
      }
      // Si on force, arrête les pistes de l'ancien flux
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing },
        audio: true,
      });
      cameraPreview.srcObject = cameraStream;
    } catch (err) {
      console.error('Erreur lors de l\'initialisation de la caméra :', err);
      alert("Impossible d'accéder à la caméra ou au micro. Vérifiez les autorisations du navigateur.");
    }
  }

  /**
   * Handle selection of an audio file. Displays its name and prepares the
   * audio player. Enables the record button once a song is chosen.
   * @param {Event} event
   */
  function handleFileSelection(event) {
    const file = event.target.files[0];
    if (!file) {
      selectedFileName = '';
      fileInfo.textContent = '';
      songTimer.style.display = 'none';
      recordButton.disabled = true;
      toggleSourceBtn.disabled = true;
      audioPlayer.removeAttribute('src');
      return;
    }
    selectedFileName = file.name;
    // Revoke previous URL if needed
    if (audioPlayer.src) {
      URL.revokeObjectURL(audioPlayer.src);
    }
    const url = URL.createObjectURL(file);
    audioPlayer.src = url;
    audioPlayer.load();
    fileInfo.textContent = selectedFileName;
    recordButton.disabled = false;
    toggleSourceBtn.disabled = true;
    // When metadata is loaded, display the total duration
    audioPlayer.onloadedmetadata = () => {
      songPlaying = false;
      updateSongTimer();
    };
  }

  /**
   * Display a countdown overlay for the specified number of seconds. Returns
   * a promise that resolves when the countdown completes.
   * @param {number} seconds
   * @returns {Promise<void>}
   */
  function runCountdown(seconds) {
    return new Promise((resolve) => {
      let n = seconds;
      countdownOverlay.style.display = 'flex';
      countdownOverlay.textContent = n.toString();
      const interval = setInterval(() => {
        n -= 1;
        if (n > 0) {
          countdownOverlay.textContent = n.toString();
        } else {
          clearInterval(interval);
          countdownOverlay.style.display = 'none';
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Start playback of the selected song and adjust gain nodes so that only
   * the music is included in the recorded audio. Also sets up a timer to
   * update the display and stops the recording when the song ends.
   */
  function startSong() {
    if (!audioPlayer.src) return;
    // Reset both audio elements to the beginning
    audioPlayer.currentTime = 0;
    if (songClone) songClone.currentTime = 0;
    // Mute the microphone and unmute the song in the recording
    microGain.gain.value = 0;
    songGain.gain.value = 1;
    // Start playback for both the user (audioPlayer) and the recording clone
    audioPlayer.play().catch((err) => console.warn('Erreur lecture (utilisateur) :', err));
    if (songClone) {
      songClone.play().catch((err) => console.warn('Erreur lecture (enregistrement) :', err));
    }
    songPlaying = true;
    updateSongTimer();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateSongTimer, 500);
    // Stop recording automatically when the song finishes (use the user's audio element)
    audioPlayer.onended = () => {
      if (isRecording) {
        stopRecording();
      }
    };
    // Enable the toggle button during music playback
    toggleSourceBtn.disabled = false;
    // Show the music icon and hide the mic icon
    if (micIcon) micIcon.style.display = 'none';
    if (noteToggleIcon) noteToggleIcon.style.display = 'block';
    // We are now recording the song (mic muted)
    recordingSource = 'song';
  }

  /**
   * Begin a new recording following the fixed protocol. First records
   * ambient mic audio, then after a delay and countdown switches to the
   * selected song. Sets up the audio graph for cross‑fading.
   */
  async function startRecording() {
    if (isRecording) return;
    if (!cameraStream) {
      alert('La caméra n\'est pas disponible.');
      return;
    }
    if (!audioPlayer.src) {
      alert('Veuillez d\'abord sélectionner une chanson.');
      return;
    }
    // Show countdown overlay for 3 seconds before starting any capture
    await runCountdown(3);
    // Reset state
    recordedChunks = [];
    recordingStartTime = Date.now();
    recordingSource = 'mic';
    // Show that we are currently recording the mic by updating the toggle icons
    if (micIcon) micIcon.style.display = 'block';
    if (noteToggleIcon) noteToggleIcon.style.display = 'none';
    // Create audio context and nodes
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // Microphone source from the camera stream
    const micStream = new MediaStream(cameraStream.getAudioTracks());
    microSource = audioContext.createMediaStreamSource(micStream);
    microGain = audioContext.createGain();
    microGain.gain.value = 1;
    microSource.connect(microGain);
    // Song source from the audio element
    // Create a fresh clone of the selected song for recording. This avoids
    // attempting to connect the same HTMLAudioElement to multiple
    // AudioContexts, which is not allowed in Safari. The clone is not
    // attached to the DOM and is solely used for recording.
    songClone = new Audio(audioPlayer.src || '');
    songClone.preload = 'auto';
    try {
      songSource = audioContext.createMediaElementSource(songClone);
    } catch (err) {
      console.warn('Erreur création MediaElementSource pour la chanson :', err);
      songSource = null;
    }
    songGain = audioContext.createGain();
    songGain.gain.value = 0; // muted initially
    if (songSource) {
      songSource.connect(songGain);
    }
    // Combine both gains into a destination for the recorder
    destinationNode = audioContext.createMediaStreamDestination();
    microGain.connect(destinationNode);
    songGain.connect(destinationNode);
    // Construct combined stream from camera video and processed audio
    const combinedStream = new MediaStream([
      ...cameraStream.getVideoTracks(),
      ...destinationNode.stream.getAudioTracks(),
    ]);
    try {
      mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp8,opus',
      });
    } catch (e) {
      mediaRecorder = new MediaRecorder(combinedStream);
    }
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = handleStop;
    mediaRecorder.start();
    isRecording = true;
    // Update UI
    recordButton.classList.add('recording');
    fileInput.disabled = true;
    toggleSourceBtn.disabled = true;
    // Start the song after 3 seconds of recording mic audio.
    setTimeout(() => {
      startSong();
    }, 3000);
  }

  /**
   * Stop the current recording, clean up audio resources and UI, and
   * finalise the MediaRecorder to create the recorded video.
   */
  function stopRecording() {
    if (!isRecording) return;
    // Cancel any pending song start or timers
    // No pending countdown to cancel since we no longer use setTimeout for
    // the pre‑song delay. Only clear the song timer below.
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    // Stop music playback and reset
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    // Stop the recording clone if it exists
    if (songClone) {
      try {
        songClone.pause();
        songClone.currentTime = 0;
      } catch (e) {
        console.warn('Erreur en arrêtant la chanson de clonage :', e);
      }
    }
    // Disable toggle while finalising
    toggleSourceBtn.disabled = true;
    // Reset record button
    recordButton.classList.remove('recording');
    fileInput.disabled = false;
    // Stop MediaRecorder; handleStop will be invoked automatically
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isRecording = false;
  }

  /**
   * Handle the completion of a recording: assemble recorded chunks into a
   * Blob, create a video element for playback, add metadata (name and
   * duration), and insert it into the gallery. Also enforce a maximum
   * number of saved recordings and switch the view to the gallery.
   */
  function handleStop() {
    const blob = new Blob(recordedChunks, {
      type: mediaRecorder && mediaRecorder.mimeType ? mediaRecorder.mimeType : 'video/webm',
    });
    const url = URL.createObjectURL(blob);
    const item = document.createElement('div');
    item.classList.add('recording-item');
    // Info bar: file name and duration
    const info = document.createElement('div');
    const durationSec = Math.round((Date.now() - recordingStartTime) / 1000);
    info.textContent = `${selectedFileName} — ${formatTime(durationSec)}`;
    info.classList.add('recording-info');
    item.appendChild(info);
    // Container for the video and download link, hidden by default
    const videoContainer = document.createElement('div');
    videoContainer.style.display = 'none';
    // Video element and orientation detection
    const recordedVideo = document.createElement('video');
    recordedVideo.controls = true;
    recordedVideo.src = url;
    recordedVideo.classList.add('recorded-video');
    // Detect orientation of the recorded video once metadata is loaded. Add
    // a class accordingly so CSS can adjust its sizing for portrait or
    // landscape videos. Without this, videos may appear square or
    // unexpectedly cropped. The event handler ensures orientation is set
    // before the user interacts with the recording.
    recordedVideo.addEventListener('loadedmetadata', () => {
      const vw = recordedVideo.videoWidth || 0;
      const vh = recordedVideo.videoHeight || 0;
      if (vw && vh) {
        if (vw > vh) {
          recordedVideo.classList.add('landscape');
        } else {
          recordedVideo.classList.add('portrait');
        }
      }
    });
    // Hide the preview automatically when playback finishes. This ensures
    // returning to the list collapses the video back to a simple line.
    recordedVideo.addEventListener('ended', () => {
      recordedVideo.pause();
      recordedVideo.currentTime = 0;
      if (videoContainer) {
        videoContainer.style.display = 'none';
      }
    });
    // Also hide the preview when the user taps on the video itself. This
    // provides a simple way to close a playing preview and return to the
    // text-only list without relying solely on the info line. When tapped,
    // the video pauses, resets and the container collapses.
    recordedVideo.addEventListener('click', () => {
      recordedVideo.pause();
      recordedVideo.currentTime = 0;
      if (videoContainer) {
        videoContainer.style.display = 'none';
      }
    });
    videoContainer.appendChild(recordedVideo);
    // Download link inside the video container
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = 'cralk-recording.webm';
    downloadLink.textContent = 'Télécharger';
    downloadLink.classList.add('download-link');
    downloadLink.addEventListener('click', (e) => {
      // Prevent toggling the video when clicking the download link
      e.stopPropagation();
    });
    videoContainer.appendChild(downloadLink);
    item.appendChild(videoContainer);
    // Clicking on the info line toggles the video container visibility and controls playback
    info.addEventListener('click', () => {
      if (videoContainer.style.display === 'none') {
        // Show video and play from beginning
        videoContainer.style.display = 'block';
        recordedVideo.currentTime = 0;
        recordedVideo.play().catch(() => {});
      } else {
        // Hide video and reset playback
        recordedVideo.pause();
        recordedVideo.currentTime = 0;
        videoContainer.style.display = 'none';
      }
    });
    // Insert into gallery and enforce a maximum of 10 recordings
    recordingsContainer.appendChild(item);
    while (recordingsContainer.children.length > 10) {
      recordingsContainer.removeChild(recordingsContainer.firstChild);
    }
    // Switch to gallery view for a moment to ensure the list is updated
    showGallery();
    // After inserting the item, immediately return to the recorder view to allow
    // the user to start a new recording without a swipe gesture. Users can
    // still access the gallery by swiping.
    showRecorder();

    // Cleanup audio context and sources so a new recording can start
    try {
      if (microSource) microSource.disconnect();
      if (songSource) songSource.disconnect();
      if (microGain) microGain.disconnect();
      if (songGain) songGain.disconnect();
    } catch (e) {
      console.warn('Erreur lors du nettoyage des graphes audio :', e);
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    microSource = null;
    songSource = null;
    microGain = null;
    songGain = null;
    destinationNode = null;
    mediaRecorder = null;
    // Reset song state
    songPlaying = false;
    updateSongTimer();

    // Release the recording clone so a new one can be created on next recording
    songClone = null;

    // Reset toggle button icons to microphone by default for the next recording
    if (micIcon) micIcon.style.display = 'block';
    if (noteToggleIcon) noteToggleIcon.style.display = 'none';
    toggleSourceBtn.disabled = true;
  }

  /**
   * Toggle which audio source (mic or song) is recorded. This does not
   * interrupt playback of the song. When toggled, the gain values for
   * microphone and song are swapped.
   */
  function toggleSource() {
    if (!isRecording) return;
    // Toggle between recording the song and the mic based on current state.
    if (recordingSource === 'song') {
      // We were recording the song; switch to the microphone
      microGain.gain.value = 1;
      songGain.gain.value = 0;
      recordingSource = 'mic';
      // Show mic icon and hide note icon
      if (micIcon) micIcon.style.display = 'block';
      if (noteToggleIcon) noteToggleIcon.style.display = 'none';
    } else {
      // We were recording the microphone; switch to the song
      microGain.gain.value = 0;
      songGain.gain.value = 1;
      recordingSource = 'song';
      // Show note icon and hide mic icon
      if (micIcon) micIcon.style.display = 'none';
      if (noteToggleIcon) noteToggleIcon.style.display = 'block';
    }
  }

  /**
   * Switch the facing mode of the camera between user (front) and
   * environment (rear) and reinitialise the stream.
   */
  function switchCamera() {
    currentFacing = currentFacing === 'user' ? 'environment' : 'user';
    // Force reinitialisation du flux pour changer de caméra
    initCamera(true);
  }

  /**
   * Slide to the gallery view by adding a class to the app container.
   */
  function showGallery() {
    // Collapse all open video containers before switching screens
    collapseAllRecordings();
    appContainer.classList.add('gallery-active');
  }

  /**
   * Slide back to the recorder view by removing the gallery class.
   */
  function showRecorder() {
    // Collapse all open video containers when returning to the recorder
    collapseAllRecordings();
    appContainer.classList.remove('gallery-active');
    // Reuse the existing camera stream if it exists; otherwise request a new one.
    if (cameraStream) {
      cameraPreview.srcObject = cameraStream;
    } else {
      initCamera();
    }
  }

  /**
   * Collapse all recordings by hiding their video containers and resetting playback.
   */
  function collapseAllRecordings() {
    const items = recordingsContainer.children;
    for (const item of items) {
      // second div holds video container according to structure: info div + videoContainer
      const containers = item.querySelectorAll('div');
      if (containers.length > 1) {
        const vContainer = containers[1];
        if (vContainer && vContainer.style.display !== 'none') {
          // pause and reset video
          const video = vContainer.querySelector('video');
          if (video) {
            video.pause();
            video.currentTime = 0;
          }
          vContainer.style.display = 'none';
        }
      }
    }
  }

  /**
   * Hide the splash screen once the app has completed initialisation. This
   * function removes the splash element from the DOM to reveal the main
   * interface. It is called after the camera is ready so that users see
   * the logo while permissions are being requested.
   */
  function hideSplash() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.style.display = 'none';
    }
  }

  // ----- Event listeners -----
  fileInput.addEventListener('change', handleFileSelection);
  switchCameraBtn.addEventListener('click', switchCamera);
  toggleSourceBtn.addEventListener('click', toggleSource);
  recordButton.addEventListener('click', () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  // Gallery control: delete all recordings
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove all recorded items and revoke their object URLs
      while (recordingsContainer.firstChild) {
        const child = recordingsContainer.firstChild;
        const videoEl = child.querySelector('video');
        if (videoEl && videoEl.src) {
          URL.revokeObjectURL(videoEl.src);
        }
        recordingsContainer.removeChild(child);
      }
    });
  }

  // Gallery control: download all recordings and then clear them
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const items = Array.from(recordingsContainer.children);
      if (items.length === 0) return;
      // Trigger downloads sequentially to give the browser time to open each save dialog.
      items.forEach((item, idx) => {
        const link = item.querySelector('a.download-link');
        if (link) {
          setTimeout(() => {
            try {
              link.click();
            } catch (err) {
              console.warn('Erreur lors du clic de téléchargement :', err);
            }
          }, idx * 300);
        }
      });
      // Remove all recordings after downloads start, allowing a delay for the last click
      const totalDelay = items.length * 300 + 800;
      setTimeout(() => {
        while (recordingsContainer.firstChild) {
          const child = recordingsContainer.firstChild;
          const videoEl = child.querySelector('video');
          if (videoEl && videoEl.src) URL.revokeObjectURL(videoEl.src);
          recordingsContainer.removeChild(child);
        }
      }, totalDelay);
    });
  }

  // Gallery control: help button placeholder
  if (helpBtn) {
    helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      alert('Aide : cette fonctionnalité sera disponible prochainement.');
    });
  }
  // Swipe detection for switching screens
  let touchStartX = null;
  appContainer.addEventListener(
    'touchstart',
    (e) => {
      if (e.changedTouches.length > 0) {
        touchStartX = e.changedTouches[0].clientX;
      }
    },
    { passive: true }
  );
  appContainer.addEventListener(
    'touchend',
    (e) => {
      if (touchStartX === null) return;
      const diffX = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(diffX) > 50) {
        if (diffX < 0) {
          showGallery();
        } else {
          showRecorder();
        }
      }
      touchStartX = null;
    },
    { passive: true }
  );

  // ----- Initialisation -----
  // Request access to the camera and microphone once on initial load. The splash
  // screen will be hidden regardless of whether access is granted, so the
  // interface appears once permissions have been handled.
  initCamera()
    .catch(() => {})
    .finally(() => {
      hideSplash();
    });
  // Register service worker for offline capability and updates
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => console.error('Échec enregistrement ServiceWorker :', err));
    });
  }

  // Orientation handling: add or remove a class on the body to indicate when
  // the device is in landscape mode. This is used to rotate button labels
  // while keeping the control bar anchored at the bottom.
  function updateOrientationClass() {
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    if (isLandscape) {
      document.body.classList.add('landscape');
    } else {
      document.body.classList.remove('landscape');
    }
  }
  // Run once at start and whenever the orientation changes or the window is resized
  updateOrientationClass();
  window.addEventListener('orientationchange', updateOrientationClass);
  window.addEventListener('resize', updateOrientationClass);
})();
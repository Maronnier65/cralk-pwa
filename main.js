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

  // Modal elements for viewing recordings with swipe navigation
  const videoModal = document.getElementById('video-modal');
  const modalVideo = document.getElementById('modal-video');
  const closeModalBtn = document.getElementById('close-modal');

  // Keep a separate list of recordings with their metadata. Each entry has
  // { url, fileName, duration }. This array is used by the modal to
  // navigate between recordings without relying on DOM structure.
  const recordingsList = [];
  let currentModalIndex = null;
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
        // Ensure camera preview plays on mobile browsers; calling play() after
        // assigning the stream helps surfaces where autoplay may not start automatically.
        try {
          await cameraPreview.play();
        } catch (_) {
          // ignore errors
        }
        // On certain mobile browsers (Safari on iOS), the video element may not
        // automatically start playing after the stream is assigned, even when
        // autoplay and playsInline are set. Explicitly calling play() ensures
        // the preview becomes visible. Catch errors silently as some browsers
        // may reject the promise if autoplay is blocked.
        try {
          await cameraPreview.play();
        } catch (_) {
          // ignore any playback errors
        }
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
      try {
        await cameraPreview.play();
      } catch (_) {
        // ignore errors
      }
      try {
        await cameraPreview.play();
      } catch (_) {
        // ignore errors
      }
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
    // Reset both audio elements to the beginning and unmute the user's player
    audioPlayer.currentTime = 0;
    // Unmute the audio element now that playback should be audible
    audioPlayer.muted = false;
    if (songClone) songClone.currentTime = 0;
    // Mute the microphone and unmute the song in the recording
    microGain.gain.value = 0;
    songGain.gain.value = 1;
    // Start playback for the recording clone. The user's audio element is
    // already playing (triggered at the start of recording), so we only
    // need to start the clone if it exists.
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
    // Prime the song playback during the countdown. Playing the audio element
    // while muted ensures browsers (particularly Safari) consider the playback
    // to be user‑initiated. We reset the currentTime and mute the element
    // so it is inaudible during the countdown. When the song starts, it will
    // be unmuted in startSong().
    audioPlayer.currentTime = 0;
    audioPlayer.muted = true;
    audioPlayer.play().catch(() => {});
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
      console.warn('Erreur création MediaElementSource pour la chanson :', err);
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
    // Immediately start the song once the recording begins. The countdown
    // duration is not captured in the final video. By calling startSong()
    // here, the music will begin at the same time as the recording and
    // the microphone is muted. The toggle button can then be used to
    // switch between mic and song without needing to manually start the
    // music.
    startSong();
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
    // Compute duration based on recording start time
    const durationSec = Math.round((Date.now() - recordingStartTime) / 1000);
    // Add to our recordings list for modal navigation
    const recIndex = recordingsList.length;
    recordingsList.push({ url, fileName: selectedFileName, duration: durationSec });
    // Create grid item with preview and overlay
    const item = document.createElement('div');
    item.classList.add('recording-item');
    const preview = document.createElement('video');
    preview.src = url;
    preview.muted = true;
    preview.playsInline = true;
    preview.loop = true;
    preview.preload = 'metadata';
    preview.classList.add('preview-video');
    item.appendChild(preview);
    const overlay = document.createElement('div');
    overlay.classList.add('recording-info-overlay');
    overlay.textContent = `${selectedFileName} — ${formatTime(durationSec)}`;
    item.appendChild(overlay);
    // Start playing the preview silently once it's loaded
    preview.addEventListener('loadeddata', () => {
      preview.play().catch(() => {});
    });
    // When the item is tapped, open the modal at this recording's index
    item.addEventListener('click', (e) => {
      // Ignore clicks on download links (if any)
      if (e.target.tagName === 'A') return;
      openModal(recIndex);
    });
    recordingsContainer.appendChild(item);
    // Limit to 10 recordings in the gallery
    while (recordingsContainer.children.length > 10) {
      // Remove the first child and revoke its URL
      const child = recordingsContainer.firstChild;
      const videoEl = child.querySelector('video');
      if (videoEl && videoEl.src) {
        URL.revokeObjectURL(videoEl.src);
      }
      recordingsContainer.removeChild(child);
      // Also remove from recordingsList
      recordingsList.shift();
    }
    // Immediately show and then hide the gallery to refresh layout
    showGallery();
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

    // Ensure the camera preview resumes displaying the video feed after a recording.
    // Without this, some devices may stop rendering the preview until the
    // MediaStream is reattached. Reassigning the stream and calling play
    // ensures the user sees the live camera again.
    if (cameraStream) {
      cameraPreview.srcObject = cameraStream;
      try {
        cameraPreview.play();
      } catch (_) {
        // ignore play errors (may occur if not allowed)
      }
    }
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
      // Ensure the preview starts playing when returning to the recorder
      try {
        cameraPreview.play();
      } catch (_) {
        // ignore playback errors
      }
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
      // Clear the recordings list as well
      recordingsList.splice(0, recordingsList.length);
    });
  }

  // Gallery control: download all recordings and then clear them
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (recordingsList.length === 0) return;
      // Create hidden anchor and trigger downloads sequentially. Use the recordingsList
      recordingsList.forEach((rec, idx) => {
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = rec.url;
          a.download = 'cralk-recording.webm';
          a.style.display = 'none';
          document.body.appendChild(a);
          try {
            a.click();
          } catch (err) {
            console.warn('Erreur lors du clic de téléchargement :', err);
          }
          document.body.removeChild(a);
        }, idx * 300);
      });
      // After the last download, clear all recordings and the list
      const totalDelay = recordingsList.length * 300 + 800;
      setTimeout(() => {
        while (recordingsContainer.firstChild) {
          const child = recordingsContainer.firstChild;
          const videoEl = child.querySelector('video');
          if (videoEl && videoEl.src) {
            URL.revokeObjectURL(videoEl.src);
          }
          recordingsContainer.removeChild(child);
        }
        recordingsList.splice(0, recordingsList.length);
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
        .catch((err) => console.error('Échec enregistrement ServiceWorker :', err));
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

  // ----- Modal functions for viewing recordings -----

  /**
   * Open the modal to view a recording at the given index. Loads the video
   * source, plays it and updates the current index. If the index is
   * invalid, the modal is not displayed.
   * @param {number} index
   */
  function openModal(index) {
    const rec = recordingsList[index];
    if (!rec) return;
    // Stop any currently playing modal video
    if (!modalVideo.paused) {
      modalVideo.pause();
    }
    modalVideo.src = rec.url;
    modalVideo.currentTime = 0;
    modalVideo.play().catch(() => {});
    videoModal.style.display = 'flex';
    currentModalIndex = index;
  }

  /**
   * Close the modal and stop playback of the current video.
   */
  function closeModal() {
    if (!modalVideo.paused) {
      modalVideo.pause();
    }
    videoModal.style.display = 'none';
    currentModalIndex = null;
  }

  /**
   * Show the next recording in the modal. Wraps around at the end.
   */
  function nextModal() {
    if (currentModalIndex === null) return;
    let nextIndex = currentModalIndex + 1;
    if (nextIndex >= recordingsList.length) nextIndex = 0;
    openModal(nextIndex);
  }

  /**
   * Show the previous recording in the modal. Wraps around to the last.
   */
  function prevModal() {
    if (currentModalIndex === null) return;
    let prevIndex = currentModalIndex - 1;
    if (prevIndex < 0) prevIndex = recordingsList.length - 1;
    openModal(prevIndex);
  }

  // Close the modal when the close button is clicked
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeModal();
    });
  }

  // Close the modal when tapping outside the video element
  if (videoModal) {
    videoModal.addEventListener('click', (e) => {
      // Only close if click occurs on the overlay itself, not the video or buttons
      if (e.target === videoModal) {
        closeModal();
      }
    });
  }

  // Swipe detection within the modal for navigating between recordings
  let modalStartX = null;
  if (videoModal) {
    videoModal.addEventListener('touchstart', (e) => {
      if (e.changedTouches.length > 0) {
        modalStartX = e.changedTouches[0].clientX;
      }
    }, { passive: true });
    videoModal.addEventListener('touchend', (e) => {
      if (modalStartX === null) return;
      const diffX = e.changedTouches[0].clientX - modalStartX;
      if (Math.abs(diffX) > 50) {
        if (diffX < 0) {
          nextModal();
        } else {
          prevModal();
        }
      }
      modalStartX = null;
    }, { passive: true });
  }
})();

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
  let preSongTimeout = null;          // Timeout to trigger countdown/song
  let timerInterval = null;           // Interval to update the song timer
  let recordingStartTime = null;      // Timestamp when recording began
  let selectedFileName = '';          // Name of the chosen audio file

  // Track whether the song is currently playing to toggle the timer between
  // total duration and remaining time
  let songPlaying = false;

  // Track which source is currently being recorded ('song' or 'mic'). This
  // avoids relying on gain values directly when toggling.
  let recordingSource = 'mic';

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
  async function initCamera() {
    // Stop any existing tracks
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    try {
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
    audioPlayer.currentTime = 0;
    // When the song starts, mute the mic and unmute the song in the recorded
    // stream. The song is always sent to the user via context.destination.
    microGain.gain.value = 0;
    songGain.gain.value = 1;
    // Start playback
    audioPlayer.play().catch((err) => console.warn('Erreur lecture :', err));
    songPlaying = true;
    updateSongTimer();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateSongTimer, 500);
    // Stop recording automatically when the song finishes
    audioPlayer.onended = () => {
      if (isRecording) {
        stopRecording();
      }
    };
    // Enable the toggle button during music playback
    toggleSourceBtn.disabled = false;
    // Initialise button label to reflect that the mic is currently muted
    const label = toggleSourceBtn.querySelector('.btn-label');
    if (label) label.textContent = 'Mic';

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
    // Reset state
    recordedChunks = [];
    recordingStartTime = Date.now();
    recordingSource = 'mic';
    // Create audio context and nodes
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // Microphone source from the camera stream
    const micStream = new MediaStream(cameraStream.getAudioTracks());
    microSource = audioContext.createMediaStreamSource(micStream);
    microGain = audioContext.createGain();
    microGain.gain.value = 1;
    microSource.connect(microGain);
    // Song source from the audio element
    songSource = audioContext.createMediaElementSource(audioPlayer);
    songGain = audioContext.createGain();
    songGain.gain.value = 0; // muted initially
    songSource.connect(songGain);
    // Always send the song to the user's speakers
    songSource.connect(audioContext.destination);
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
    const recLabel = recordButton.querySelector('.btn-label');
    if (recLabel) recLabel.textContent = 'Stop';
    fileInput.disabled = true;
    toggleSourceBtn.disabled = true;
    // After 5 seconds, start countdown and then begin the song
    preSongTimeout = setTimeout(async () => {
      await runCountdown(3);
      startSong();
    }, 5000);
  }

  /**
   * Stop the current recording, clean up audio resources and UI, and
   * finalise the MediaRecorder to create the recorded video.
   */
  function stopRecording() {
    if (!isRecording) return;
    // Cancel any pending song start or timers
    if (preSongTimeout) {
      clearTimeout(preSongTimeout);
      preSongTimeout = null;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    // Stop music playback and reset
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    // Disable toggle while finalising
    toggleSourceBtn.disabled = true;
    // Reset record button
    recordButton.classList.remove('recording');
    const recLabel = recordButton.querySelector('.btn-label');
    if (recLabel) recLabel.textContent = 'Rec';
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
    // Video element (hidden by default) and orientation detection
    const recordedVideo = document.createElement('video');
    recordedVideo.controls = true;
    recordedVideo.src = url;
    recordedVideo.classList.add('recorded-video');
    recordedVideo.style.display = 'none';
    recordedVideo.addEventListener('loadedmetadata', () => {
      try {
        if (recordedVideo.videoWidth > recordedVideo.videoHeight) {
          recordedVideo.classList.add('landscape');
        } else {
          recordedVideo.classList.add('portrait');
        }
      } catch (e) {
        console.warn("Impossible de déterminer l'orientation de la vidéo", e);
      }
    });
    item.appendChild(recordedVideo);
    // Clicking on the item toggles the visibility of the video and controls playback
    item.addEventListener('click', () => {
      const hidden = recordedVideo.style.display === 'none';
      recordedVideo.style.display = hidden ? 'block' : 'none';
      if (!hidden) {
        // When hiding, pause and reset the video
        recordedVideo.pause();
        recordedVideo.currentTime = 0;
      }
    });
    // Download link
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = 'cralk-recording.webm';
    downloadLink.textContent = 'Télécharger';
    downloadLink.classList.add('download-link');
    item.appendChild(downloadLink);
    // Insert into gallery and enforce a maximum of 10 recordings
    recordingsContainer.appendChild(item);
    while (recordingsContainer.children.length > 10) {
      recordingsContainer.removeChild(recordingsContainer.firstChild);
    }
    // Switch to gallery view
    showGallery();

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
  }

  /**
   * Toggle which audio source (mic or song) is recorded. This does not
   * interrupt playback of the song. When toggled, the gain values for
   * microphone and song are swapped.
   */
  function toggleSource() {
    if (!isRecording) return;
    const label = toggleSourceBtn.querySelector('.btn-label');
    // Toggle between recording the song and the mic based on current state.
    if (recordingSource === 'song') {
      // Currently recording song; switch to mic
      microGain.gain.value = 1;
      songGain.gain.value = 0;
      recordingSource = 'mic';
      if (label) label.textContent = 'Chanson';
    } else {
      // Currently recording mic; switch to song
      microGain.gain.value = 0;
      songGain.gain.value = 1;
      recordingSource = 'song';
      if (label) label.textContent = 'Mic';
    }
  }

  /**
   * Switch the facing mode of the camera between user (front) and
   * environment (rear) and reinitialise the stream.
   */
  function switchCamera() {
    currentFacing = currentFacing === 'user' ? 'environment' : 'user';
    initCamera();
  }

  /**
   * Slide to the gallery view by adding a class to the app container.
   */
  function showGallery() {
    appContainer.classList.add('gallery-active');
  }

  /**
   * Slide back to the recorder view by removing the gallery class.
   */
  function showRecorder() {
    appContainer.classList.remove('gallery-active');
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
  initCamera();
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
})();
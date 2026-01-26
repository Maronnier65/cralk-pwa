/*
 * main.js
 *
 * This script handles the core logic of the CRALK PWA. It allows users to
 * select an audio file from their local files, displays basic information
 * about the selected file, and plays the audio using the HTML5 <audio> element.
 * It also registers the service worker to enable installation as a PWA.
 */

/*
 * This version of main.js extends the original CRALK PWA to support
 * recording a video using the device camera and microphone while
 * synchronising the recorded footage with a selected audio file. It uses
 * MediaStream APIs and the Web Audio API to merge the audio from the
 * uploaded song with the microphone input so that the resulting
 * recording contains both the music and any vocal performance. The
 * MediaStream constructor allows us to combine tracks from different
 * streams into one【988212847256470†L210-L213】, and captureStream() on
 * media elements produces a stream from the content being played【28336664549183†L185-L209】.
 */

/**
 * main.js
 *
 * This script provides the core logic for the camera‑first CRALK PWA. It
 * displays the device camera as soon as the page loads and overlays a
 * handful of controls to switch cameras, toggle the microphone, select a
 * background song, and start/stop a synchronized recording. The recorded
 * video contains the selected music track mixed with optional ambient
 * microphone audio and is presented back to the user with a download link.
 */

(function () {
  // UI element references
  const fileInput = document.getElementById('file-input');
  const fileInfo = document.getElementById('file-info');
  const audioPlayer = document.getElementById('audio-player');
  const cameraPreview = document.getElementById('camera-preview');
  const switchCameraBtn = document.getElementById('switch-camera');
  const toggleMicBtn = document.getElementById('toggle-mic');
  const recordButton = document.getElementById('record-button');
  const playMusicBtn = document.getElementById('play-music');
  // Container in the gallery for recorded videos
  const recordingsContainer = document.getElementById('gallery-recordings');

  // Reference to the app container for page switching
  const appContainer = document.getElementById('app-container');

  // State variables
  let currentUrl = null; // object URL for the selected audio file
  let cameraStream = null; // stream from getUserMedia
  let currentFacing = 'environment'; // default to rear camera for better quality
  let micEnabled = true; // whether the microphone should be included
  let isRecording = false; // whether a recording is currently in progress
  let mediaRecorder = null;
  let recordedChunks = [];
  let audioContext = null;
  let audioSource = null;
  let destinationNode = null;
  // Track music play state; relies on audioPlayer.paused property
  let musicStarted = false;

  // Disable music playback button until a song is selected
  playMusicBtn.disabled = true;

  /**
   * Initialize the camera preview using the current facing mode. Any
   * existing camera stream is stopped before requesting a new one.
   */
  async function initCamera() {
    // Stop all existing tracks to free the camera/mic
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    try {
      const constraints = {
        video: { facingMode: currentFacing },
        audio: true,
      };
      cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      // Apply the stream to the video element
      cameraPreview.srcObject = cameraStream;
      // Enable/disable microphone track based on state
      cameraStream.getAudioTracks().forEach((track) => {
        track.enabled = micEnabled;
      });
    } catch (err) {
      console.error('Erreur lors de l\'initialisation de la caméra:', err);
      alert(
        "Impossible d'accéder à la caméra ou au micro. Vérifiez les autorisations du navigateur."
      );
    }
  }

  /**
   * Handle audio file selection. Create an object URL for the file so it can
   * be played and display basic metadata to the user.
   * @param {Event} event
   */
  function handleFileSelection(event) {
    const file = event.target.files[0];
    if (!file) {
      fileInfo.textContent = '';
      audioPlayer.removeAttribute('src');
      return;
    }
    // Clean up previous URL
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
    currentUrl = URL.createObjectURL(file);
    audioPlayer.src = currentUrl;
    audioPlayer.load();
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
    fileInfo.textContent = `${file.name} — ${sizeInMB} MB`;

    // Enable the record button when an audio file is selected
    recordButton.disabled = false;
    // Reset music control button
    playMusicBtn.disabled = false;
    playMusicBtn.textContent = '▶︎';
  }

  /**
   * Combine two audio streams into a single set of tracks using the Web
   * Audio API. This function is based on a technique to merge multiple
   * sources with adjustable gain【257458881368227†L30-L58】.
   * @param {MediaStream} stream1 - The first audio stream (e.g., song).
   * @param {MediaStream} stream2 - The second audio stream (e.g., mic).
   * @returns {MediaStreamTrack[]} The merged audio tracks.
   */
  function mergeAudioStreams(stream1, stream2) {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const source1 = context.createMediaStreamSource(stream1);
    const source2 = context.createMediaStreamSource(stream2);
    const destination = context.createMediaStreamDestination();
    const gain1 = context.createGain();
    const gain2 = context.createGain();
    // Default volumes; adjust here if needed
    gain1.gain.value = 0.7;
    gain2.gain.value = 0.7;
    source1.connect(gain1).connect(destination);
    source2.connect(gain2).connect(destination);
    return destination.stream.getAudioTracks();
  }

  /**
   * Start a recording. Combines the camera video with the selected song and
   * optionally the microphone audio into a single MediaStream. The
   * MediaRecorder API encodes the stream to WebM, which is saved as a
   * Blob. UI elements are updated to reflect the recording state.
   */
  async function startRecording() {
    if (!cameraStream) {
      alert('La caméra n\'est pas disponible.');
      return;
    }
    if (!audioPlayer.src) {
      alert('Veuillez d\'abord sélectionner une chanson.');
      return;
    }
    // Reset recorded data
    recordedChunks = [];
    // Prepare audio context and nodes
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioSource = audioContext.createMediaElementSource(audioPlayer);
    destinationNode = audioContext.createMediaStreamDestination();
    audioSource.connect(destinationNode);
    audioSource.connect(audioContext.destination);
    // Restart the song from the beginning
    audioPlayer.currentTime = 0;
    try {
      await audioPlayer.play();
      playMusicBtn.textContent = '⏸';
    } catch (err) {
      console.warn('Erreur lors de la lecture du fichier audio :', err);
    }
    // Determine which audio tracks to include
    let mergedAudioTracks;
    if (micEnabled) {
      // Merge the song (destinationNode) with the mic from cameraStream
      mergedAudioTracks = mergeAudioStreams(destinationNode.stream, cameraStream);
    } else {
      // Only use the song audio
      mergedAudioTracks = destinationNode.stream.getAudioTracks();
    }
    // Get the single video track
    const videoTracks = cameraStream.getVideoTracks();
    // Combine tracks into a new MediaStream
    const combinedStream = new MediaStream([...videoTracks, ...mergedAudioTracks]);
    // Initialise MediaRecorder
    try {
      mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp8,opus',
      });
    } catch (err) {
      console.warn('Type MIME non pris en charge, utilisation de la valeur par défaut.');
      mediaRecorder = new MediaRecorder(combinedStream);
    }
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    mediaRecorder.onstop = handleStop;
    mediaRecorder.start();
    isRecording = true;
    // Update button appearance
    recordButton.classList.add('recording');
    recordButton.textContent = 'Stop';
  }

  /**
   * Stop an ongoing recording and reset UI elements. The song playback
   * pauses and the MediaRecorder is instructed to stop.
   */
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    playMusicBtn.textContent = '▶︎';
    isRecording = false;
    recordButton.classList.remove('recording');
    recordButton.textContent = 'Rec';
  }

  /**
   * Assemble the recorded data into a Blob, create a video element for
   * playback, and provide a download link. Previous recordings are
   * appended to the gallery. Automatically switches to the gallery
   * view when a new recording is saved.
   */
  function handleStop() {
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
    const url = URL.createObjectURL(blob);
    // Create a container for this recording
    const item = document.createElement('div');
    const recordedVideo = document.createElement('video');
    recordedVideo.controls = true;
    recordedVideo.src = url;
    recordedVideo.classList.add('recorded-video');
    // Déterminer l'orientation du clip enregistré. Certains appareils retournent
    // des flux vidéo pivotés (par ex. rotation de 90°) sans ajuster
    // videoWidth/videoHeight, ce qui entraîne une lecture déformée. Pour
    // améliorer la détection, on récupère d'abord les dimensions du flux via
    // getSettings() lorsque c'est possible, puis on bascule sur les propriétés
    // du <video> en cas d'échec. Enfin, on applique une classe CSS pour
    // ajuster le rendu sans déformer le contenu.
    try {
      let width, height;
      // Utiliser les settings de la piste vidéo pour obtenir la taille native
      if (cameraStream && cameraStream.getVideoTracks().length > 0) {
        const settings = cameraStream.getVideoTracks()[0].getSettings();
        width = settings.width;
        height = settings.height;
      }
      // Si les settings ne sont pas disponibles, se replier sur l'élément vidéo
      if (!width || !height) {
        width = cameraPreview.videoWidth;
        height = cameraPreview.videoHeight;
      }
      if (width && height) {
        if (width > height) {
          recordedVideo.classList.add('landscape');
        } else {
          recordedVideo.classList.add('portrait');
        }
      }
    } catch (e) {
      console.warn("Impossible de déterminer l'orientation de la vidéo", e);
    }
    item.appendChild(recordedVideo);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = 'cralk-recording.webm';
    downloadLink.textContent = 'Télécharger la vidéo';
    downloadLink.classList.add('download-link');
    item.appendChild(downloadLink);
    recordingsContainer.appendChild(item);
    // After saving, switch to the gallery screen
    showGallery();
  }

  /**
   * Toggle the camera facing mode between 'user' and 'environment' and
   * reinitialise the stream.
   */
  function switchCamera() {
    currentFacing = currentFacing === 'user' ? 'environment' : 'user';
    initCamera();
  }

  /**
   * Toggle the inclusion of microphone audio. When disabled, the mic track
   * is muted and the ambient sound will not be recorded.
   */
  function toggleMic() {
    micEnabled = !micEnabled;
    // Update track enabled state
    if (cameraStream) {
      cameraStream.getAudioTracks().forEach((track) => {
        track.enabled = micEnabled;
      });
    }
    // Optionally update the button appearance
    if (micEnabled) {
      toggleMicBtn.classList.remove('disabled');
    } else {
      toggleMicBtn.classList.add('disabled');
    }
  }

  // Event listeners
  fileInput.addEventListener('change', handleFileSelection);
  switchCameraBtn.addEventListener('click', switchCamera);
  toggleMicBtn.addEventListener('click', toggleMic);
  playMusicBtn.addEventListener('click', toggleMusic);
  recordButton.addEventListener('click', () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  /**
   * Switch the view to the gallery screen by adding a class to the
   * app container. The CSS rules will handle the sliding animation.
   */
  function showGallery() {
    appContainer.classList.add('gallery-active');
  }

  /**
   * Switch the view back to the recorder screen by removing the
   * gallery-active class.
   */
  function showRecorder() {
    appContainer.classList.remove('gallery-active');
  }

  // Swipe handling: detect horizontal swipes to change screens
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
        // Swipe left moves to gallery; swipe right returns to recorder
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

  // On page load, initialise the camera preview
  initCamera();

  // Register the service worker for offline use and installation prompts
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((error) => {
          console.error('Échec de l\'enregistrement du ServiceWorker :', error);
        });
    });
  }

  /**
   * Toggle the playback of the selected music. If the audio is paused, start
   * playing and update the button label; if it is playing, pause it and
   * reset the icon. This allows the user to manually control when the
   * background song starts or stops.
   */
  function toggleMusic() {
    if (!audioPlayer.src) return;
    if (audioPlayer.paused) {
      audioPlayer.play();
      playMusicBtn.textContent = '⏸';
    } else {
      audioPlayer.pause();
      playMusicBtn.textContent = '▶︎';
    }
  }
})();
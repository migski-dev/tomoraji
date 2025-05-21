const socket = io();

// Audio context and elements
let audioContext;
let mediaSource;
let sourceBuffer;
let mediaSourceReady = false;
let audioQueue = [];
let currentBroadcasterId = null;
let currentMimeType = 'audio/webm;codecs=opus'; // Default MIME type
let pendingChunks = []; // Store chunks until MediaSource is ready

// DOM elements
const broadcastersListElement = document.getElementById('broadcastersList');
const noBroadcastersElement = document.getElementById('noBroadcasters');
const refreshButton = document.getElementById('refreshButton');
const currentlyListeningElement = document.getElementById('currentlyListening');

// Audio element for MediaSource API streaming
const audioElement = document.createElement('audio');
audioElement.autoplay = true;
document.body.appendChild(audioElement);
audioElement.style.display = 'none'; // Hide the audio element

// Initialize audio system
function initAudioSystem() {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('Audio context initialized:', audioContext.state);
    } catch (err) {
      console.error('Failed to initialize audio context:', err);
      alert('Your browser may not fully support audio playback features.');
    }
  }
  
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(err => {
      console.error('Failed to resume audio context:', err);
    });
  }
}

// Initialize MediaSource for streaming audio
function setupMediaSource() {
  try {
    // Abort any existing MediaSource
    if (mediaSource) {
      if (mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream();
        } catch (e) {
          console.log('Error ending previous MediaSource stream:', e);
        }
      }
    }
    
    mediaSource = new MediaSource();
    mediaSourceReady = false;
    audioElement.src = URL.createObjectURL(mediaSource);
    
    mediaSource.addEventListener('sourceopen', function() {
      console.log('MediaSource opened');
      mediaSourceReady = true;
      
      try {
        // Remove any existing source buffers
        // if (sourceBuffer) {
        //   try {
        //     mediaSource.removeSourceBuffer(sourceBuffer);
        //   } catch (e) {
        //     console.log('Error removing previous SourceBuffer:', e);
        //   }
        // }
        
        // Create a new source buffer with the right MIME type
        sourceBuffer = mediaSource.addSourceBuffer(currentMimeType);
        sourceBuffer.mode = 'sequence'; // Use sequence mode to avoid timestamp issues
        
        sourceBuffer.addEventListener('updateend', function() {
          // Process any pending chunks when the buffer is ready for more
          processNextChunk();
        });
        
        // Process any chunks we received while waiting for MediaSource to be ready
        if (pendingChunks.length > 0) {
          console.log(`Processing ${pendingChunks.length} pending chunks`);
          processNextChunk();
        }
      } catch (e) {
        console.error('Error setting up SourceBuffer:', e);
        mediaSourceReady = false;
        
        // Try a fallback MIME type if the current one failed
        if (currentMimeType.includes('opus')) {
          console.log('Trying fallback to standard WebM audio...');
          currentMimeType = 'audio/webm';
          setupMediaSource(); // Retry with different MIME type
        } else if (currentMimeType === 'audio/webm') {
          console.log('Trying fallback to MP4 audio...');
          currentMimeType = 'audio/mp4';
          setupMediaSource(); // Retry with MP4
        } else {
          alert('Your browser does not support the required audio formats.');
        }
      }
    });
    
    mediaSource.addEventListener('sourceended', function() {
      console.log('MediaSource ended');
    });
    
    mediaSource.addEventListener('sourceclose', function() {
      console.log('MediaSource closed');
    });
  } catch (err) {
    console.error('Error setting up MediaSource:', err);
    alert('Your browser may not support MediaSource API for streaming audio.');
  }
}

// Process the next chunk in the queue
function processNextChunk() {
  // If we're still updating or there are no chunks, don't do anything
  if (sourceBuffer && sourceBuffer.updating) {
    return;
  }
  
  if (pendingChunks.length === 0) {
    return;
  }
  
  if (!mediaSourceReady || !sourceBuffer) {
    return;
  }
  
  try {
    const chunk = pendingChunks.shift();
    sourceBuffer.appendBuffer(chunk);
  } catch (e) {
    console.error('Error appending buffer:', e);
    
    // If we get a QuotaExceededError, try to evict some data
    if (e.name === 'QuotaExceededError') {
      console.log('Buffer full, removing old data');
      // If we have more than 10 seconds of audio, remove the first 5 seconds
      if (sourceBuffer.buffered.length > 0 && sourceBuffer.buffered.end(0) - sourceBuffer.buffered.start(0) > 10) {
        sourceBuffer.remove(sourceBuffer.buffered.start(0), sourceBuffer.buffered.start(0) + 5);
      } else {
        // If we can't remove data, drop this chunk
        console.log('Unable to free space, dropping chunk');
      }
    }
    
    // Schedule the next chunk regardless of error
    setTimeout(processNextChunk, 100);
  }
}

// Check browser compatibility for MediaSource API and audio formats
function checkMediaSourceCompatibility() {
  const compatibility = {
    mediaSourceSupported: typeof MediaSource !== 'undefined',
    webmSupported: false,
    mp4Supported: false,
    oggSupported: false
  };
  
  if (compatibility.mediaSourceSupported) {
    compatibility.webmSupported = MediaSource.isTypeSupported('audio/webm; codecs=opus');
    compatibility.mp4Supported = MediaSource.isTypeSupported('audio/mp4');
    compatibility.oggSupported = MediaSource.isTypeSupported('audio/ogg; codecs=opus');
  }
  
  console.log('MediaSource compatibility:', compatibility);
  
  // Update MIME type based on compatibility
  if (compatibility.webmSupported) {
    currentMimeType = 'audio/webm; codecs=opus';
  } else if (compatibility.mp4Supported) {
    currentMimeType = 'audio/mp4';
  } else if (compatibility.oggSupported) {
    currentMimeType = 'audio/ogg; codecs=opus';
  }
  
  return compatibility;
}

// Get the list of active broadcasters when the page loads
socket.on('connect', () => {
  socket.emit('get-broadcasters');
  
  // Check compatibility
  const compatibility = checkMediaSourceCompatibility();
  
  // Initialize audio
  if (compatibility.mediaSourceSupported) {
    initAudioSystem();
  } else {
    alert('Your browser does not support the MediaSource API required for audio streaming.');
  }
});

// Refresh the list of broadcasters
refreshButton.addEventListener('click', () => {
  socket.emit('get-broadcasters');
});

// Update the broadcasters list when received from server
socket.on('update-broadcasters', (broadcasters) => {
  broadcastersListElement.innerHTML = '';
  
  if (broadcasters.length === 0) {
    noBroadcastersElement.style.display = 'block';
    return;
  }
  
  noBroadcastersElement.style.display = 'none';
  
  broadcasters.forEach(broadcaster => {
    const broadcasterItem = document.createElement('div');
    broadcasterItem.className = 'broadcaster-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = broadcaster.name;
    
    const tuneButton = document.createElement('button');
    tuneButton.className = 'tune-button';
    
    if (currentBroadcasterId === broadcaster.id) {
      tuneButton.textContent = 'Stop Listening';
      tuneButton.classList.add('listening');
    } else {
      tuneButton.textContent = 'Listen';
    }
    
    tuneButton.addEventListener('click', () => {
      // Initialize audio on user interaction
      initAudioSystem();
      
      if (currentBroadcasterId === broadcaster.id) {
        // Stop listening to this broadcaster
        socket.emit('leave-broadcast', broadcaster.id);
        currentBroadcasterId = null;
        tuneButton.textContent = 'Listen';
        tuneButton.classList.remove('listening');
        currentlyListeningElement.textContent = 'Not listening to any broadcast';
        
        // Clean up audio
        if (mediaSource && mediaSource.readyState === 'open') {
          try {
            mediaSource.endOfStream();
          } catch (e) {
            console.log('Error ending MediaSource stream:', e);
          }
        }
        audioElement.pause();
        pendingChunks = [];
      } else {
        // If listening to another broadcaster, leave that broadcast first
        if (currentBroadcasterId) {
          socket.emit('leave-broadcast', currentBroadcasterId);
          
          // Update the button for the previous broadcaster
          const prevButton = document.querySelector(`.tune-button.listening`);
          if (prevButton) {
            prevButton.textContent = 'Listen';
            prevButton.classList.remove('listening');
          }
        }
        
        // Join the new broadcast
        socket.emit('join-broadcast', broadcaster.id);
        currentBroadcasterId = broadcaster.id;
        tuneButton.textContent = 'Stop Listening';
        tuneButton.classList.add('listening');
        currentlyListeningElement.textContent = `Listening to: ${broadcaster.name}`;
        
        // Reset audio for new broadcast
        pendingChunks = [];
        setupMediaSource();
      }
    });
    
    broadcasterItem.appendChild(nameSpan);
    broadcasterItem.appendChild(tuneButton);
    broadcastersListElement.appendChild(broadcasterItem);
  });
});

// Handle incoming audio chunks using MediaSource API
socket.on('audio-chunk', async (data) => {
  // Ensure audio is initialized
  if (!audioContext) {
    initAudioSystem();
  }
  
  try {
    // Extract the data and MIME type
    let audioBlob;
    let mimeType;
    
    if (data.data && data.mimeType) {
      // New format with explicit MIME type
      audioBlob = data.data;
      mimeType = data.mimeType;
      
      // Update MIME type if it's different
      // if (mimeType !== currentMimeType && mediaSourceReady) {
      //   console.log(`MIME type changed from ${currentMimeType} to ${mimeType}`);
      //   currentMimeType = mimeType;
        
      //   // We need to reset MediaSource when MIME type changes
      //   setupMediaSource();
      // }
    } else {
      // Old format (just the blob)
      audioBlob = data;
      mimeType = currentMimeType;
    }
    
    // Convert blob to ArrayBuffer
    const arrayBuffer = await new Response(audioBlob).arrayBuffer();
    
    // Add the chunk to the pending queue
    pendingChunks.push(arrayBuffer);
    
    // Try to process it if possible
    if (mediaSourceReady && sourceBuffer && !sourceBuffer.updating) {
      processNextChunk();
    }
  } catch (error) {
    console.error('Error processing incoming audio chunk:', error);
  }
});

// Add a debug button with enhanced information
const debugButton = document.createElement('button');
debugButton.textContent = 'Debug Audio Status';
debugButton.style.marginTop = '20px';
debugButton.style.padding = '5px 10px';
debugButton.addEventListener('click', () => {
  // Check if we need to recreate the media source due to errors
  const mediaSourceState = mediaSource ? mediaSource.readyState : 'none';
  if (mediaSourceState === 'closed' && currentBroadcasterId) {
    console.log('MediaSource was closed, recreating...');
    setupMediaSource();
  }
  
  console.log('Audio Context State:', audioContext ? audioContext.state : 'not initialized');
  console.log('MediaSource State:', mediaSourceState);
  console.log('MediaSource Ready:', mediaSourceReady);
  console.log('Current Broadcaster:', currentBroadcasterId);
  console.log('Current MIME Type:', currentMimeType);
  console.log('Pending Chunks:', pendingChunks.length);
  
  if (sourceBuffer && sourceBuffer.buffered.length > 0) {
    console.log('Buffer Range:', 
      sourceBuffer.buffered.start(0), 
      'to', 
      sourceBuffer.buffered.end(0), 
      '(', sourceBuffer.buffered.end(0) - sourceBuffer.buffered.start(0), 'seconds)'
    );
  }
  
  console.log('MediaSource Support:', checkMediaSourceCompatibility());
  
  if (audioContext) {
    alert(`Audio debugging info has been logged to the console.
Context: ${audioContext.state}
MediaSource: ${mediaSourceState}
MIME Type: ${currentMimeType}
Pending Chunks: ${pendingChunks.length}`);
  } else {
    alert('Audio context not initialized. Try clicking Listen first.');
  }
});
document.querySelector('.container').appendChild(debugButton);

// Handle page unload
window.addEventListener('beforeunload', () => {
  if (currentBroadcasterId) {
    socket.emit('leave-broadcast', currentBroadcasterId);
  }
  
  // Clean up MediaSource
  if (mediaSource && mediaSource.readyState === 'open') {
    try {
      mediaSource.endOfStream();
    } catch (e) {
      console.log('Error ending MediaSource stream during unload:', e);
    }
  }
});

// Add a helpful notification to users about browser compatibility
const compatibilityInfo = checkMediaSourceCompatibility();
if (!compatibilityInfo.webmSupported && !compatibilityInfo.mp4Supported) {
  const infoBox = document.createElement('div');
  infoBox.style.backgroundColor = '#fff3cd';
  infoBox.style.color = '#856404';
  infoBox.style.padding = '15px';
  infoBox.style.borderRadius = '5px';
  infoBox.style.margin = '20px 0';
  infoBox.style.maxWidth = '500px';
  infoBox.style.width = '100%';
  infoBox.innerHTML = `
    <strong>Browser Compatibility Notice:</strong>
    <p>Your browser might have limited support for streaming audio formats. 
    For the best experience, we recommend using Chrome, Edge, or Firefox.</p>
  `;
  document.querySelector('.container').insertBefore(infoBox, broadcastersListElement);
}
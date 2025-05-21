const socket = io();

// Audio context and elements
let audioContext;
let audioQueue = [];
let isPlaying = false;
let currentBroadcasterId = null;
let currentMimeType = 'audio/webm'; // Default MIME type

// DOM elements
const broadcastersListElement = document.getElementById('broadcastersList');
const noBroadcastersElement = document.getElementById('noBroadcasters');
const refreshButton = document.getElementById('refreshButton');
const currentlyListeningElement = document.getElementById('currentlyListening');

// Initialize audio context (will be started on first user interaction)
function initAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 44100 // Use standard sample rate for best compatibility
    });
  }
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

// Get the list of active broadcasters when the page loads
socket.on('connect', () => {
  socket.emit('get-broadcasters');
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
      initAudioContext(); // Ensure audio context is initialized
      
      if (currentBroadcasterId === broadcaster.id) {
        // Stop listening to this broadcaster
        socket.emit('leave-broadcast', broadcaster.id);
        currentBroadcasterId = null;
        tuneButton.textContent = 'Listen';
        tuneButton.classList.remove('listening');
        currentlyListeningElement.textContent = 'Not listening to any broadcast';
        
        // Clear the audio queue
        audioQueue = [];
        isPlaying = false;
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
          
          // Clear the audio queue
          audioQueue = [];
          isPlaying = false;
        }
        
        // Join the new broadcast
        socket.emit('join-broadcast', broadcaster.id);
        currentBroadcasterId = broadcaster.id;
        tuneButton.textContent = 'Stop Listening';
        tuneButton.classList.add('listening');
        currentlyListeningElement.textContent = `Listening to: ${broadcaster.name}`;
      }
    });
    
    broadcasterItem.appendChild(nameSpan);
    broadcasterItem.appendChild(tuneButton);
    broadcastersListElement.appendChild(broadcasterItem);
  });
});

// Handle incoming audio chunks
socket.on('audio-chunk', async (data) => {
  if (!audioContext) {
    initAudioContext();
  }
  
  try {
    // Extract the data and MIME type
    let audioBlob;
    let mimeType;
    
    if (data.data && data.mimeType) {
      // New format with explicit MIME type
      audioBlob = data.data;
      mimeType = data.mimeType;
      currentMimeType = mimeType; // Update the current MIME type
    } else {
      // Old format (just the blob)
      audioBlob = data;
      mimeType = currentMimeType;
    }
    
    // Debug information
    console.log(`Received chunk with MIME type: ${mimeType}`);
    
    // Convert blob to ArrayBuffer
    const arrayBuffer = await new Response(audioBlob).arrayBuffer();
    
    // Add to queue with MIME type info
    audioQueue.push({
      buffer: arrayBuffer,
      mimeType: mimeType
    });
    
    // Start playing if not already
    if (!isPlaying) {
      playNextInQueue();
    }
  } catch (error) {
    console.error('Error processing incoming audio chunk:', error);
  }
});

// Play the next audio chunk in the queue
async function playNextInQueue() {
  if (audioQueue.length === 0) {
    isPlaying = false;
    return;
  }
  
  isPlaying = true;
  
  try {
    const chunk = audioQueue.shift();
    const arrayBuffer = chunk.buffer;
    
    // Create an audio buffer from the array buffer
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer).catch(error => {
      console.error('Error decoding audio data:', error, 'Type:', chunk.mimeType);
      throw error; // Re-throw to be caught by the outer try/catch
    });
    
    // Create a source node
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    
    // Add a gain node for volume control
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0; // Normal volume
    
    // Connect nodes
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // When this chunk ends, play the next one
    source.onended = playNextInQueue;
    
    // Start playback
    source.start(0);
    
    // If the queue is getting too long, trim it to prevent memory issues
    if (audioQueue.length > 20) {
      console.log(`Queue too long (${audioQueue.length}), trimming...`);
      audioQueue = audioQueue.slice(-10); // Keep only the last 10 chunks
    }
  } catch (error) {
    console.error('Error playing audio:', error);
    // Skip this chunk and try the next one
    setTimeout(playNextInQueue, 100);
  }
}

// Add a debug button
const debugButton = document.createElement('button');
debugButton.textContent = 'Debug Audio Status';
debugButton.style.marginTop = '20px';
debugButton.style.padding = '5px 10px';
debugButton.addEventListener('click', () => {
  console.log('Audio Context State:', audioContext ? audioContext.state : 'not initialized');
  console.log('Queue Length:', audioQueue.length);
  console.log('Is Playing:', isPlaying);
  console.log('Current Broadcaster:', currentBroadcasterId);
  console.log('Current MIME Type:', currentMimeType);
  
  if (audioContext) {
    alert(`Audio debugging info has been logged to console.\nContext: ${audioContext.state}\nQueue: ${audioQueue.length} chunks`);
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
});
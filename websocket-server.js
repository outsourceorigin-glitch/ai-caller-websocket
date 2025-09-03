const { WebSocketServer } = require('ws');
const WebSocket = require('ws');

console.log('🚀 Starting dedicated WebSocket server for Twilio Media Streams...');
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

// Check for OpenAI API key
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

console.log('🔑 OpenAI API Key:', process.env.OPENAI_API_KEY.substring(0, 10) + '...');

// Get port from environment or default to 8080
const PORT = process.env.PORT || 8080;

// Create WebSocket server
const wss = new WebSocketServer({ 
  port: PORT,
  host: '0.0.0.0', // Listen on all interfaces for external access
  path: '/twilio-stream'
});

console.log(`🌐 WebSocket server running on ws://0.0.0.0:${PORT}/twilio-stream`);
console.log(`🌍 External URL: wss://ai-order.osc-fr1.scalingo.io/twilio-stream`);

wss.on('connection', (ws, request) => {
  console.log('📞 New Twilio Media Stream connection established');
  
  let openaiWs = null;
  let streamSid = '';
  let callSid = '';
  let isOpenAIConnected = false;
  let sessionCreated = false;

  // Initialize OpenAI Realtime connection
  const initOpenAI = async () => {
    try {
      console.log('🤖 Connecting to OpenAI Realtime API...');
      
      // Create OpenAI WebSocket connection
      openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      openaiWs.on('open', () => {
        console.log('✅ OpenAI Realtime connected - Ready for instant responses!');
        isOpenAIConnected = true;
        
        // Configure session for immediate response
        const sessionConfig = {
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'], // ✅ Fixed: Both audio and text modalities
            instructions: `You are the AI assistant for Big Daddy restaurant. 

IMMEDIATELY when the session starts, say: "Hi! Welcome to Big Daddy! I'm here to take your order. What would you like today?"

MENU: 
- Chicken Burger: $12.99
- Beef Burger: $19.99

Be natural, friendly, and efficient. Take their order, get their name and address, confirm everything, and calculate the total.

Start speaking right away when the call connects!`,
            voice: 'alloy',
            input_audio_format: 'g711_ulaw',
            output_audio_format: 'g711_ulaw',
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
            tool_choice: 'none',
            temperature: 0.8,
          },
        };

        openaiWs.send(JSON.stringify(sessionConfig));
        console.log('🔧 OpenAI session configured for instant ordering');
      });

      openaiWs.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());
          
          switch (response.type) {
            case 'session.created':
              console.log('🎯 OpenAI session created - AI is ready!');
              sessionCreated = true;
              
              // ✅ Trigger immediate greeting
              console.log('🎤 Triggering immediate AI greeting...');
              const greetingTrigger = {
                type: 'response.create',
                response: {
                  modalities: ['audio', 'text'],
                  instructions: 'Say the greeting immediately: "Hi! Welcome to Big Daddy! I\'m here to take your order. What would you like today?"'
                }
              };
              openaiWs.send(JSON.stringify(greetingTrigger));
              break;
              
            case 'response.audio.delta':
              // Forward audio back to Twilio immediately
              if (ws.readyState === WebSocket.OPEN && streamSid) {
                const audioMessage = {
                  event: 'media',
                  streamSid: streamSid,
                  media: {
                    payload: response.delta
                  }
                };
                ws.send(JSON.stringify(audioMessage));
              }
              break;
              
            case 'response.done':
              console.log('✅ OpenAI response completed');
              break;
              
            case 'conversation.item.created':
              if (response.item?.content) {
                const userText = response.item.content
                  .filter(c => c.type === 'input_text' || c.type === 'text')
                  .map(c => c.text || c.transcript)
                  .join(' ');
                if (userText) {
                  console.log('👤 Customer said:', userText);
                }
              }
              break;
              
            case 'error':
              console.error('❌ OpenAI error:', response.error);
              break;
              
            default:
              console.log('📋 OpenAI event:', response.type);
          }
        } catch (error) {
          console.error('❌ Error parsing OpenAI message:', error);
        }
      });

      openaiWs.on('error', (error) => {
        console.error('❌ OpenAI WebSocket error:', error);
        isOpenAIConnected = false;
      });

      openaiWs.on('close', () => {
        console.log('🔌 OpenAI WebSocket closed');
        isOpenAIConnected = false;
      });

    } catch (error) {
      console.error('❌ Error initializing OpenAI:', error);
    }
  };

  // Handle Twilio WebSocket messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.event) {
        case 'connected':
          console.log('🔗 Twilio stream connected');
          break;
          
        case 'start':
          streamSid = data.start.streamSid;
          callSid = data.start.callSid;
          console.log(`🎵 Stream started: ${streamSid} for call: ${callSid}`);
          
          // Initialize OpenAI connection when stream starts
          initOpenAI();
          break;
          
        case 'media':
          // Forward audio to OpenAI Realtime immediately
          if (openaiWs && isOpenAIConnected && openaiWs.readyState === WebSocket.OPEN) {
            const audioMessage = {
              type: 'input_audio_buffer.append',
              audio: data.media.payload
            };
            openaiWs.send(JSON.stringify(audioMessage));
          }
          break;
          
        case 'stop':
          console.log(`📞 Stream stopped: ${streamSid}`);
          if (openaiWs) {
            openaiWs.close();
          }
          break;
      }
    } catch (error) {
      console.error('❌ Error parsing Twilio message:', error);
    }
  });

  ws.on('close', () => {
    console.log('📞 Twilio stream connection closed');
    if (openaiWs) {
      openaiWs.close();
    }
  });

  ws.on('error', (error) => {
    console.error('❌ Twilio WebSocket error:', error);
  });
});

console.log('🎯 WebSocket server ready for OpenAI Realtime API connections!');
console.log('📞 Waiting for Twilio Media Streams...');

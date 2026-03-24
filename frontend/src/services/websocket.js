const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8000/ws';

let reconnectTimeout = null;

export const connectWebSocket = (token, onMessage) => {
  let isIntentionallyClosed = false;
  let ws = new WebSocket(WS_URL);
  let reconnectTimeout = null;

  const connect = () => {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'new_alert') {
          const alert = data.data;
          if (alert.message_type) alert.message_type = alert.message_type.toLowerCase();
          if (alert.status) alert.status = alert.status.toLowerCase();
          onMessage(alert);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      if (!isIntentionallyClosed) {
        console.log('WebSocket disconnected. Reconnecting in 3s...');
        reconnectTimeout = setTimeout(() => connect(), 3000);
      } else {
        console.log('WebSocket closed intentionally.');
      }
    };
  };

  connect();

  return {
    disconnect: () => {
      isIntentionallyClosed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    }
  };
};

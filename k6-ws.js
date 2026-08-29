import ws from "k6/experimental/websockets";
import { check } from "k6";
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = __ENV.BASE_URL || "wss://ito.imanuraglol.workers.dev";

export const options = {
  stages: [
    { duration: "30s", target: 50 },
    { duration: "2m", target: 200 },
    { duration: "30s", target: 0 },
  ],
};

export default function () {
  // Use many rooms so you test horizontal DO scaling, not one global bottleneck.
  const roomId = `room-${__VU % 20}`;
  const userId = `user-${__VU}`;
  const url = `${BASE_URL}/sync/ws?roomId=${roomId}&userId=${userId}&name=Test&color=#ef4444`;

  const socket = new ws(url);

  socket.onopen = () => {
    // Send cursor events every 500ms-1500ms to simulate live presence.
    const interval = setInterval(
      () => {
        socket.send(
          JSON.stringify({
            type: "cursor",
            x: randomIntBetween(0, 1000),
            y: randomIntBetween(0, 800),
          }),
        );
      },
      randomIntBetween(500, 1500),
    );

    socket.setInterval(() => socket.send("ping"), 10000);

    // Close after 30s.
    socket.setTimeout(() => {
      clearInterval(interval);
      socket.close();
    }, 30000);
  };

  socket.onmessage = (msg) => {
    check(msg, {
      "received message": (m) => m.data && m.data.length > 0,
    });
  };

  socket.onerror = (e) => {
    console.error(`WS error: ${e.error}`);
  };
}

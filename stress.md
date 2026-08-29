Your app has two very different scaling profiles, so the approach depends on what you want to measure:

┌───────────────────────────────────┬────────────────────────────────┬────────────────────────────────────────────────────────────────────────────┐
│ Part │ Scaling characteristic │ Likely bottleneck │
├───────────────────────────────────┼────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ HTTP REST API (/sync/pull, │ Stateless Workers, scales │ D1 SQLite (queries/sec, connection/row locking), your rate limiter, CPU │
│ /sync/push, /) │ horizontally │ time per request │
├───────────────────────────────────┼────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ WebSocket presence room │ One Durable Object per roomId │ Single Durable Object thread; CPU/memory per object, WebSocket message │
│ (/sync/ws) │ │ throughput, broadcast fan-out │
└───────────────────────────────────┴────────────────────────────────┴────────────────────────────────────────────────────────────────────────────┘

You can’t just “how many concurrent clients” globally — a global load test will mostly measure D1 + the one DO for room "global". Here’s how to
stress test both parts safely on the hosted Workers.

────────────────────────────────────────────────────────────────────────────────

1.  What Cloudflare limits apply to you

Check your plan, but typical limits:

- Worker CPU time: Free 10 ms / paid 50 ms (can burst/unbound up to 30 s for paid, but billed).
- D1: Free has daily reads/writes limits; paid has query volume / storage. It’s SQLite — concurrent writes serialize on the DB connection pool.
- Durable Object: One event loop per object. All messages to the same roomId are processed serially. WebSocket Hibernation API can hold thousands
  of idle connections, but active broadcast fan-out costs CPU.
- WebSockets: 32 KB message size, 1000 max connections per Worker invocation in some configurations, but DO hibernation supports many more idle
  sockets.
- Rate limiter: You already use API_RATE_LIMITER. That will cap push throughput per userId.

Because your /sync/push does multiple D1 writes + a DO broadcast in a loop over mutations, it is the most expensive endpoint.

────────────────────────────────────────────────────────────────────────────────

2.  Tools to use

- HTTP: k6 (https://k6.io/) (best JS scripting + metrics), oha (https://github.com/hatoo/oha), autocannon (https://github.com/mcollina/autocannon),
  or wrk.
- WebSocket: k6 has k6/experimental/websockets, or use websocat / a small Node script for raw load.
- Observability: Cloudflare dashboard → Workers & Pages → your worker → Metrics; also enable Workers Analytics Engine or Tail (wrangler tail) to
  watch errors/CPU.

I recommend k6 because you can script the exact pull/push/mutation flow and vary virtual users.

────────────────────────────────────────────────────────────────────────────────

3.  HTTP stress test with k6

Install k6, then run against your deployed worker. I’ve created a starter script in this repo.

server/stress/k6-http.js

```js
import http from "k6/http";
import { check, sleep } from "k6";
import { randomString } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = __ENV.BASE_URL || "https://ito.imanuraglol.workers.dev";

export const options = {
  // Ramp up: start low, increase gradually so you don't DDoS yourself.
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 50 },
    { duration: "2m", target: 100 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
  },
};

function pull() {
  const res = http.get(`${BASE_URL}/sync/pull?lastPulledAt=1970-01-01T00:00:00.000Z`, {
    tags: { name: "pull" },
  });
  check(res, {
    "pull status 200": (r) => r.status === 200,
    "pull json": (r) => r.json("issues") !== undefined,
  });
}

function push() {
  const id = uuidv4();
  const userId = `user-${__VU}`;
  const payload = JSON.stringify({
    mutations: [
      {
        id: `mut-${id}`,
        type: "create",
        entity: "issue",
        targetId: id,
        baseVersion: 1,
        userId,
        data: {
          title: `Stress ${randomString(8)}`,
          description: "load test",
          status: "open",
          priority: "medium",
          position: 0,
          labels: ["stress"],
        },
      },
    ],
  });

  const res = http.post(`${BASE_URL}/sync/push?roomId=stress`, payload, {
    headers: { "Content-Type": "application/json" },
    tags: { name: "push" },
  });

  check(res, {
    "push status 200/429": (r) => r.status === 200 || r.status === 429,
    "push no 500": (r) => r.status !== 500,
  });
}

export default function () {
  // 80% reads, 20% writes — adjust to match real usage
  if (Math.random() < 0.8) {
    pull();
  } else {
    push();
  }
  sleep(Math.random() * 2 + 0.5);
}
```

Run it:

```bash
  cd server/stress
  k6 run -e BASE_URL=https://ito.imanuraglol.workers.dev k6-http.js
```

Watch the Cloudflare dashboard for:

- Error rate
- CPU time per request (especially /sync/push)
- D1 query volume
- Rate-limiter 429 responses

────────────────────────────────────────────────────────────────────────────────

4.  WebSocket / Durable Object stress test

This is the trickier one. Every connection targets the same DO if roomId is the same, so concurrency on "global" will bottleneck on one event loop.
To test real multi-room scale, randomize roomId.

server/stress/k6-ws.js

```js
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
```

Run:

```bash
  k6 run -e BASE_URL=wss://ito.imanuraglol.workers.dev k6-ws.js
```

────────────────────────────────────────────────────────────────────────────────

5.  Important testing caveats

1.  Don’t test roomId=global at massive scale — it uses one Durable Object. Test with many room IDs to see real Worker horizontal scaling.
1.  Your push loop is O(N) D1 + DO calls per request — if a client sends many mutations at once, CPU time will spike. Test with realistic batch
    sizes.
1.  D1 is SQLite — heavy concurrent /sync/push writes will serialize and can queue. Watch D1 metrics for query latency, not just Worker CPU.
1.  Rate limiter will 429 you — that’s expected. If you want to test throughput ceiling, create many userIds (like user-${__VU}).
1.  Clean up after tests — your stress tests create issues in D1. Add a delete/cleanup phase, or run against a staging DB/worker.
1.  Watch costs — Cloudflare Workers/D1/Durable Objects are cheap, but a long high-load test can generate many billable requests. Start small.

────────────────────────────────────────────────────────────────────────────────

6.  How to define “how many concurrent clients”

Ask it per endpoint:

┌────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Scenario │ Definition │
├────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Idle WebSocket users │ How many open sockets can one DO hold? Usually thousands with hibernation, but test with your presence broadcast │
│ │ logic. │
├────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Active cursor broadcasters │ How many users can send cursor updates per second before the DO CPU saturates? │
├────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Sync pull throughput │ How many /sync/pull req/sec before D1 or Worker CPU limits? │
├────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Sync push throughput │ How many mutation batches/sec before D1 write serialization or rate-limiter kicks in? │
└────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

A good target to start measuring:

```bash
  # 1. Max steady-state HTTP RPS
  k6 run --vus 100 --duration 60s k6-http.js

  # 2. Max concurrent WebSocket connections
  k6 run --vus 1000 --duration 120s k6-ws.js
```

Then increase VUs until you see:

- http_req_duration p95 > 1 s
- Error rate > 1 %
- Cloudflare Worker CPU time near 50 ms
- D1 query latency climbing
- WebSocket close/error rate climbing

────────────────────────────────────────────────────────────────────────────────

7.  Quick wins if load testing exposes bottlenecks

Looking at your current code, if tests show limits:

- D1 writes: Add Promise.all where safe, or reduce mutation batch size.
- Pull all rows: /sync/pull currently fetches entire tables if lastPulledAt is old. Add pagination/cursor.
- Single global DO: Move real users into distinct roomIds (e.g., per board/project).
- DO broadcast: broadcastPresence sends to every socket on every cursor move — throttle to e.g., 30 fps or only when position changes
  significantly.
- Push loop: Each mutation does separate inserts. Consider batching D1 operations or moving heavy logging to Analytics/Queue.

────────────────────────────────────────────────────────────────────────────────

Want me to add these two scripts to your repo, plus a GitHub Actions workflow that runs a small load test on deploy?

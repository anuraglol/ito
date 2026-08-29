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

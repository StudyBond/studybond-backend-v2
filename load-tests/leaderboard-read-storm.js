import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || '';
const AUTH_HEADERS = ACCESS_TOKEN
  ? { Authorization: `Bearer ${ACCESS_TOKEN}` }
  : {};

export const options = {
  scenarios: {
    steady_reads: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 150 },
        { duration: '90s', target: 300 },
        { duration: '30s', target: 0 }
      ],
      gracefulRampDown: '15s',
      exec: 'readFlow'
    },
    burst_windows: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 0 },
        { duration: '20s', target: 500 },
        { duration: '20s', target: 0 },
        { duration: '20s', target: 650 },
        { duration: '20s', target: 0 }
      ],
      gracefulRampDown: '15s',
      exec: 'readFlow'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:leaderboard_weekly}': ['p(95)<80', 'p(99)<200'],
    'http_req_duration{endpoint:leaderboard_all_time}': ['p(95)<80', 'p(99)<200'],
    'http_req_duration{endpoint:leaderboard_my_rank}': ['p(95)<120', 'p(99)<260']
  }
};

function request(path, endpointTag) {
  const response = http.get(`${BASE_URL}${path}`, {
    headers: AUTH_HEADERS,
    tags: { endpoint: endpointTag }
  });

  check(response, {
    [`${endpointTag} status acceptable`]: (res) => [200, 401, 403, 429].includes(res.status)
  });
}

function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function readFlow() {
  group('leaderboard reads', () => {
    const limit = randomItem([10, 20, 50]);
    request(`/api/leaderboard/weekly?limit=${limit}`, 'leaderboard_weekly');
    request(`/api/leaderboard/all-time?limit=${limit}`, 'leaderboard_all_time');

    // my-rank has different DB query profile; keep it in the mix.
    if (randomIntBetween(1, 100) <= 65) {
      request('/api/leaderboard/my-rank', 'leaderboard_my_rank');
    }
  });

  sleep(randomIntBetween(1, 4));
}

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500']
  }
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';

export default function () {
  const response = http.get(`${BASE_URL}/health`, {
    tags: { endpoint: 'health' }
  });

  check(response, {
    'health endpoint returns 200': (res) => res.status === 200
  });

  sleep(0.5);
}

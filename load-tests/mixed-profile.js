import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || '';
const EXAM_ID = __ENV.EXAM_ID || '1';
const COLLAB_CODE = (__ENV.COLLAB_CODE || 'ABCD1234').toUpperCase();
const COLLAB_SESSION_ID = __ENV.COLLAB_SESSION_ID || '1';

const commonHeaders = ACCESS_TOKEN
  ? {
      Authorization: `Bearer ${ACCESS_TOKEN}`
    }
  : {};

export const options = {
  scenarios: {
    exams_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '60s', target: 250 },
        { duration: '30s', target: 0 }
      ],
      gracefulRampDown: '15s',
      exec: 'examsFlow'
    },
    collaboration_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 60 },
        { duration: '60s', target: 120 },
        { duration: '30s', target: 0 }
      ],
      gracefulRampDown: '15s',
      exec: 'collaborationFlow'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    'http_req_duration{endpoint:auth_refresh}': ['p(95)<120', 'p(99)<350'],
    'http_req_duration{endpoint:exam_start}': ['p(95)<120', 'p(99)<500'],
    'http_req_duration{endpoint:exam_submit}': ['p(95)<120', 'p(99)<500'],
    'http_req_duration{endpoint:collab_create}': ['p(95)<120', 'p(99)<500'],
    'http_req_duration{endpoint:collab_join}': ['p(95)<120', 'p(99)<500'],
    'http_req_duration{endpoint:collab_start}': ['p(95)<120', 'p(99)<500']
  }
};

function withIdempotency(headers, prefix) {
  return {
    ...headers,
    'Idempotency-Key': `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  };
}

export function examsFlow() {
  if (!ACCESS_TOKEN) {
    sleep(1);
    return;
  }

  group('auth refresh', () => {
    const refreshResponse = http.post(
      `${BASE_URL}/api/auth/refresh`,
      JSON.stringify({ refreshToken: __ENV.REFRESH_TOKEN || 'missing' }),
      {
        headers: {
          'Content-Type': 'application/json'
        },
        tags: { endpoint: 'auth_refresh' }
      }
    );
    check(refreshResponse, {
      'auth refresh status acceptable': (res) => res.status === 200 || res.status === 401
    });
  });

  group('exam start', () => {
    const subjects = randomItem([
      ['Biology'],
      ['Chemistry'],
      ['Physics'],
      ['Mathematics'],
      ['Biology', 'Physics']
    ]);

    const startResponse = http.post(
      `${BASE_URL}/api/exams/start`,
      JSON.stringify({
        examType: 'PRACTICE',
        subjects
      }),
      {
        headers: {
          ...withIdempotency(commonHeaders, 'exam-start'),
          'Content-Type': 'application/json'
        },
        tags: { endpoint: 'exam_start' }
      }
    );

    check(startResponse, {
      'exam start status acceptable': (res) => [201, 403, 409, 429].includes(res.status)
    });
  });

  group('exam submit', () => {
    const submitResponse = http.post(
      `${BASE_URL}/api/exams/${EXAM_ID}/submit`,
      JSON.stringify({
        answers: []
      }),
      {
        headers: {
          ...withIdempotency(commonHeaders, 'exam-submit'),
          'Content-Type': 'application/json'
        },
        tags: { endpoint: 'exam_submit' }
      }
    );

    check(submitResponse, {
      'exam submit status acceptable': (res) => [200, 400, 404, 409, 429].includes(res.status)
    });
  });

  sleep(randomIntBetween(1, 4));
}

export function collaborationFlow() {
  if (!ACCESS_TOKEN) {
    sleep(1);
    return;
  }

  group('collab create', () => {
    const response = http.post(
      `${BASE_URL}/api/collaboration/create`,
      JSON.stringify({
        sessionType: 'ONE_V_ONE_DUEL',
        subjects: ['Biology']
      }),
      {
        headers: {
          ...withIdempotency(commonHeaders, 'collab-create'),
          'Content-Type': 'application/json'
        },
        tags: { endpoint: 'collab_create' }
      }
    );
    check(response, {
      'collab create status acceptable': (res) => [201, 403, 409, 429].includes(res.status)
    });
  });

  group('collab join', () => {
    const response = http.post(
      `${BASE_URL}/api/collaboration/code/${COLLAB_CODE}/join`,
      null,
      {
        headers: withIdempotency(commonHeaders, 'collab-join'),
        tags: { endpoint: 'collab_join' }
      }
    );
    check(response, {
      'collab join status acceptable': (res) => [200, 403, 404, 409, 429].includes(res.status)
    });
  });

  group('collab start', () => {
    const response = http.post(
      `${BASE_URL}/api/collaboration/sessions/${COLLAB_SESSION_ID}/start`,
      null,
      {
        headers: withIdempotency(commonHeaders, 'collab-start'),
        tags: { endpoint: 'collab_start' }
      }
    );
    check(response, {
      'collab start status acceptable': (res) => [200, 403, 404, 409, 429].includes(res.status)
    });
  });

  sleep(randomIntBetween(1, 5));
}

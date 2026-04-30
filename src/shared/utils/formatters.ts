interface ClientErrorShape {
  message: string;
  code: string;
  hint?: string;
}

const ERROR_MAP: Record<string, { message: string; hint?: string }> = {
  SESSION_INVALID: {
    message: "Your session has expired. Please log in again.",
    hint: "Sign in again to continue where you stopped.",
  },
  SESSION_REPLACED: {
    message: "We signed you out because this account became active on another device or browser.",
    hint: "Use the latest approved device session to continue.",
  },
  SESSION_VALIDATION_UNAVAILABLE: {
    message: "We could not confirm your session right now.",
    hint: "Please wait a moment and retry.",
  },
  DEV_TOOLS_UNAUTHORIZED: {
    message: "The dev tools token is missing or invalid.",
    hint: "Use the configured x-dev-tools-token header for this non-production environment.",
  },
  EMAIL_NOT_VERIFIED: {
    message: "Please verify your email first.",
    hint: "Check your inbox for the OTP and complete verification.",
  },
  ACCOUNT_BANNED: {
    message: "Your account is currently suspended.",
    hint: "Contact support if you believe this is a mistake.",
  },
  EMAIL_ALREADY_IN_USE: {
    message: "An account with this email already exists.",
    hint: "Use a different email or sign in to your existing account.",
  },
  OTP_LIMIT_EXCEEDED: {
    message: "Too many OTP requests for today.",
    hint: "Please try again tomorrow.",
  },
  PREMIUM_DEVICE_CONTEXT_REQUIRED: {
    message:
      "We need this device to identify itself before premium sign-in can continue.",
    hint: "Send the device fingerprint payload from the app or web client and try again.",
  },
  MAX_DEVICES_REACHED: {
    message: "Your premium account already has two devices registered.",
    hint: "Sign in from one of your approved devices or remove one before adding another.",
  },
  EMAIL_OTP_INVALID: {
    message: "That email verification code is invalid or expired.",
    hint: "Request a fresh code and try again.",
  },
  DEVICE_OTP_INVALID: {
    message: "That premium device code is invalid or expired.",
    hint: "Start sign-in again on this device to get a fresh code.",
  },
  PASSWORD_RESET_OTP_INVALID: {
    message: "That password reset code is invalid or expired.",
    hint: "Request a fresh reset code and try again.",
  },
  PASSWORD_RESET_ATTEMPT_LIMIT_EXCEEDED: {
    message: "Too many invalid reset attempts were made for this code.",
    hint: "Request a fresh reset code and try again.",
  },
  PASSWORD_CHANGE_LIMIT_EXCEEDED: {
    message: "You have changed your password too many times today.",
    hint: "Please wait until tomorrow before changing it again.",
  },
  PASSWORD_REUSE: {
    message: "Your new password must be different from the current one.",
    hint: "Choose a fresh password you have not just used on this account.",
  },
  MEDIA_PROVIDER_NOT_CONFIGURED: {
    message: "Question image storage is not configured right now.",
    hint: "Ask an administrator to configure Cloudinary before uploading images.",
  },
  MEDIA_UPLOAD_FAILED: {
    message: "We could not upload that image right now.",
    hint: "Retry once. If the issue continues, check the image format or Cloudinary configuration.",
  },
  MEDIA_DELETE_FAILED: {
    message: "We could not clean up the previous image right now.",
    hint: "The question change may still succeed, but the media cleanup should be reviewed.",
  },
  BOOKMARK_ALREADY_EXISTS: {
    message: "That question is already in your bookmarks.",
    hint: "Open your bookmarks list if you want to update its note instead.",
  },
  BOOKMARK_LIMIT_REACHED: {
    message: "You have reached your active bookmark limit.",
    hint: "Remove an older bookmark or upgrade if you need more space.",
  },
  BOOKMARK_EXPIRED: {
    message: "That bookmark has expired.",
    hint: "Save the question again if you still want quick access to it.",
  },
  BOOKMARK_EXAM_QUESTION_MISMATCH: {
    message: "That question does not belong to the exam you selected.",
    hint: "Use the exam where you actually saw the question, or leave examId out.",
  },
  OTP_CONTEXT_INVALID: {
    message:
      "This verification code is no longer valid for the current auth step.",
    hint: "Restart the sign-in flow and request a fresh code if needed.",
  },
  EXAM_START_RATE_LIMIT: {
    message: "You are starting exams too quickly.",
    hint: "Please wait briefly before starting another exam.",
  },
  EXAM_SUBMIT_IN_PROGRESS: {
    message: "Your exam is currently being submitted.",
    hint: "Please wait a few seconds and avoid tapping submit repeatedly.",
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    message: "This request needs an Idempotency-Key header.",
    hint: "Send a unique key so retries stay safe and consistent.",
  },
  IDEMPOTENCY_KEY_REUSE_MISMATCH: {
    message: "This idempotency key was already used with a different request.",
    hint: "Generate a new key for the new payload.",
  },
  IDEMPOTENCY_IN_PROGRESS: {
    message: "A matching request is already being processed.",
    hint: "Wait briefly and retry with the same idempotency key.",
  },
  IDEMPOTENCY_REPLAY_MISSING: {
    message: "We could not replay the earlier request safely.",
    hint: "Retry with a fresh idempotency key.",
  },
  WS_EVENT_ID_REQUIRED: {
    message: "Realtime event id is required for this action.",
    hint: "Send a unique eventId so duplicate retries can be deduplicated.",
  },
  WS_CONNECTION_REPLACED: {
    message: "Your session reconnected on another device or tab.",
    hint: "Use the latest active connection to continue.",
  },
  COLLAB_SESSION_FULL: {
    message: "This duel room is already full.",
    hint: "Ask your friend to create a new room and share the new code.",
  },
  COLLAB_SESSION_NOT_JOINABLE: {
    message: "This session is no longer open for joining.",
    hint: "The host may have started or cancelled it already.",
  },
  COLLAB_SESSION_ALREADY_STARTED: {
    message: "This collaboration session already started.",
    hint: "Use the existing in-progress session details to continue.",
  },
  COLLAB_JOIN_RACE: {
    message: "Someone is joining this session right now.",
    hint: "Retry once in a second.",
  },
  COLLAB_START_RACE: {
    message: "Session start is already being processed.",
    hint: "Please wait briefly before retrying.",
  },
  COLLAB_EVENT_RATE_LIMIT: {
    message: "You are sending live events too quickly.",
    hint: "Slow down so everyone gets smoother real-time updates.",
  },
  COLLAB_SESSION_NOT_ACTIVE: {
    message: "This collaboration session is not active right now.",
    hint: "Check session state and try again.",
  },
  COLLAB_CODE_GENERATION_FAILED: {
    message: "We could not reserve a room code right now.",
    hint: "Please retry in a moment.",
  },
  COLLAB_RENAME_FAILED: {
    message: "We could not update this session name right now.",
    hint: "Please retry once. If it keeps failing, refresh your room state.",
  },
  SUBSCRIPTION_PROVIDER_NOT_CONFIGURED: {
    message: "Premium payments are not available yet.",
    hint: "Please try again later or contact support if this persists.",
  },
  SUBSCRIPTION_PROVIDER_UNAVAILABLE: {
    message: "We could not reach the payment service right now.",
    hint: "Please wait a moment and try again.",
  },
  SUBSCRIPTION_PROVIDER_INVALID_RESPONSE: {
    message: "The payment service returned an invalid response.",
    hint: "Retry once. If it keeps failing, contact support.",
  },
  SUBSCRIPTION_PROVIDER_REQUEST_FAILED: {
    message: "The payment service rejected this request.",
    hint: "Please retry once. If the issue continues, contact support.",
  },
  SUBSCRIPTION_PLAN_MISMATCH: {
    message: "This payment does not match the StudyBond premium plan.",
    hint: "Use the payment link generated inside your StudyBond account.",
  },
  SUBSCRIPTION_REFERENCE_OWNERSHIP_MISMATCH: {
    message: "This payment reference belongs to a different account.",
    hint: "Sign in with the account that started this checkout or create a new payment.",
  },
  SUBSCRIPTION_CURRENCY_MISMATCH: {
    message: "The payment currency does not match our premium plan.",
    hint: "Start a fresh checkout from StudyBond and avoid editing the payment flow.",
  },
  SUBSCRIPTION_AMOUNT_MISMATCH: {
    message: "The payment amount does not match our premium plan.",
    hint: "Use the StudyBond-generated checkout so the correct amount is charged.",
  },
  SUBSCRIPTION_EMAIL_MISMATCH: {
    message: "The payment email does not match this StudyBond account.",
    hint: "Use the same email account that started the checkout.",
  },
  SUBSCRIPTION_WEBHOOK_SIGNATURE_INVALID: {
    message: "The payment callback signature could not be trusted.",
    hint: "This callback was rejected for safety.",
  },
  SUBSCRIPTION_WEBHOOK_REFERENCE_MISSING: {
    message: "The payment callback did not include a transaction reference.",
    hint: "Retry from the payment provider or contact support.",
  },
  SUBSCRIPTION_PAYMENT_PERSISTENCE_FAILED: {
    message: "We could not safely lock this payment for activation.",
    hint: "Retry verification with the same payment reference.",
  },
  AUTH_ERROR: {
    message: "Incorrect email or password.",
    hint: "Please check your details and try again.",
  },
  VALIDATION_ERROR: {
    message: "Some input fields are invalid.",
    hint: "Review your input and try again.",
  },
  FORBIDDEN: {
    message: "You do not have permission for this action.",
  },
  NOT_FOUND: {
    message: "The requested resource was not found.",
  },
};

export function formatClientError(
  error: any,
  statusCode: number,
): ClientErrorShape {
  const code = (error?.code as string | undefined) || "REQUEST_FAILED";
  const mapped = ERROR_MAP[code];

  if (mapped) {
    return { message: mapped.message, code, hint: mapped.hint };
  }

  if (statusCode === 503) {
    return {
      message:
        "The service is temporarily unavailable. Please try again in a moment.",
      code,
      hint: "The service is being maintained or experiencing high load.",
    };
  }

  if (statusCode >= 500) {
    // If it's an operational error (AppError) or a deliberate 500 from our logic,
    // we want to see the message to help debug, especially in admin flows.
    if (error?.isOperational || error?.message) {
      return {
        message: error.message,
        code: code || 'INTERNAL_SERVER_ERROR',
        hint: 'This error originated from the application logic. Check logs for details.'
      };
    }

    return {
      message:
        "Something went wrong on our side. Please try again in a moment.",
      code,
      hint: "If this keeps happening, contact support.",
    };
  }

  if (statusCode === 401) {
    return {
      message:
        "Incorrect email or password. Please check your details and try again.",
      code,
    };
  }

  if (statusCode === 403) {
    return {
      message: error?.message || "You do not have permission for this action.",
      code,
    };
  }

  if (statusCode === 404) {
    return {
      message: error?.message || "The resource you requested was not found.",
      code,
    };
  }

  return {
    message:
      error?.message ||
      "Request failed. Please check your input and try again.",
    code,
  };
}

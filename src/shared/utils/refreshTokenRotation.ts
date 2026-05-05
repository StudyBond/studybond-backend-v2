export type RefreshTokenRotationDecision =
  | {
      action: 'rotate';
      nextTokenVersion: number;
    }
  | {
      action: 'reuse-current';
      tokenVersion: number;
    }
  | {
      action: 'reject';
    };

/**
 * Separate BFF requests can hit refresh at the same time after an access token
 * expires. We allow the immediately previous refresh-token version to reuse the
 * current session version so those concurrent requests converge instead of
 * forcing a logout.
 */
export function decideRefreshTokenRotation(
  sessionTokenVersion: number,
  payloadTokenVersion?: number
): RefreshTokenRotationDecision {
  const requestedTokenVersion =
    typeof payloadTokenVersion === 'number'
      ? payloadTokenVersion
      : sessionTokenVersion;

  if (requestedTokenVersion === sessionTokenVersion) {
    return {
      action: 'rotate',
      nextTokenVersion: sessionTokenVersion + 1
    };
  }

  if (requestedTokenVersion === sessionTokenVersion - 1) {
    return {
      action: 'reuse-current',
      tokenVersion: sessionTokenVersion
    };
  }

  return {
    action: 'reject'
  };
}

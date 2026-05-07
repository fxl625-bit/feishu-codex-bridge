export function isAuthorizedUser(
  allowedOpenIds: readonly string[],
  senderOpenId: string,
): boolean {
  const normalizedSenderOpenId = senderOpenId.trim();

  return normalizedSenderOpenId.length > 0 && allowedOpenIds.includes(normalizedSenderOpenId);
}

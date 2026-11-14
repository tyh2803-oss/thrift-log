export const PROFILE_PHOTO_KEY = 'thrift_log_avatar';
export const DEMO_PROFILE_KEY = 'thrift-log.demo.profile-photo.v1';

/** Metadata is user-editable. It is never an identity or authorization source. */
export function profilePhotoPath(
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  const value = metadata?.[PROFILE_PHOTO_KEY];
  return typeof value === 'string' &&
    value.startsWith(`${userId}/`) &&
    /^[a-f0-9-]{36}\/profile-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.jpg$/.test(
      value,
    )
    ? value
    : null;
}

export function demoProfilePhoto(value: unknown) {
  return typeof value === 'string' &&
    value.length < 700000 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value)
    ? value
    : null;
}

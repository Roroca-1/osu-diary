// Codes are shared between language-independent jobs and each browser's locale.
export function errorCode(error) {
  if (['INVALID_BUCKET_STEP', 'DATE_REQUIRED', 'MAP_REQUIRED', 'MAP_NOT_FOUND', 'INVALID_JSON', 'METHOD_NOT_ALLOWED', 'PLAYER_FILTER_REQUIRED'].includes(error.code)) return error.code;
  const message = String(error.message || '');
  if (message.includes('找不到 lazer')) return 'REALM_NOT_FOUND';
  if (message.includes('realm 文件不存在')) return 'REALM_NOT_FOUND';
  if (message.includes('缺少 osu! API 凭证')) return 'API_CREDENTIALS_REQUIRED';
  if (message.includes('缺少 osu 用户 ID')) return 'USER_ID_REQUIRED';
  if (message.includes('获取 token 失败')) return 'API_AUTH_FAILED';
  return 'REQUEST_FAILED';
}

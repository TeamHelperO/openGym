/* Roles inside an academy, and the platform settings read from the environment. */
export const ROLES = ['gym_admin', 'trainer', 'student'];
export const STAFF = ['gym_admin', 'trainer'];
export const ADMIN = ['gym_admin'];

export function saasConfig(env = process.env) {
  return {
    platformName: env.PLATFORM_NAME || 'FitHub Gestão',
    saasMode: env.SAAS_MODE !== 'off',
    exerciseMedia: env.EXERCISE_MEDIA === 'on',
    publicGymSignup: env.PUBLIC_SIGNUP_GYMS !== 'off',
    sourceUrl: env.SOURCE_URL || 'https://github.com/TeamHelperO/openGym'
  };
}

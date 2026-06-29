// Central environment configuration for CPCMS backend.
// All deployment-specific values come from environment variables with safe local defaults.

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8000', 10),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://edgesmith:edgesmith@localhost:5432/edgesmith',
  jwtSecret: process.env.SECRET_KEY || process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
  // 8 hours (one shift) default — accepts ACCESS_TOKEN_EXPIRE_MINUTES for parity with the prior backend
  accessTokenExpireMinutes: parseInt(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || '480', 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  shifts: {
    1: process.env.SHIFT_1_START || '06:00',
    2: process.env.SHIFT_2_START || '14:00',
    3: process.env.SHIFT_3_START || '22:00',
  },
};

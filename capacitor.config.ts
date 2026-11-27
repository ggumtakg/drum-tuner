import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.personal.drumtuner',
  appName: '드럼 튜너',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;

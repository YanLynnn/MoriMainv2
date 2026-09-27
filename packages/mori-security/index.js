// Mori Native Security Plugin Bridge
import { registerPlugin } from '@capacitor/core';

export const MoriSecurity = registerPlugin('MoriSecurity', {
  web: () => import('./web').then(m => new m.MoriSecurityWeb()),
});

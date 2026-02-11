
export interface RememberedPerson {
  name: string;
  imageBase64: string;
}

export interface LanguageOption {
  code: string;
  name: string;
  voice: 'Kore' | 'Puck' | 'Charon' | 'Zephyr' | 'Fenrir';
}

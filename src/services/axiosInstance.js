import config from '../config/config.js';

export const axiosInstance = async (endpoint) => {
  let lastError = null;

  for (const baseurl of config.baseurls) {
    try {
      const response = await fetch(baseurl + endpoint, {
        headers: {
          ...(config.headers || {}),
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.text();

      return {
        success: true,
        data,
        baseurl,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    success: false,
    message: lastError?.message || 'Unable to connect to upstream source',
  };
};

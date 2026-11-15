import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.APP_URL || 'https://samiti-management.vercel.app';
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login', '/admin/login'],
        disallow: [
          '/admin/',
          '/api/',
          '/home',
          '/my-savings',
          '/my-loan',
          '/meetings',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}


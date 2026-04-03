import { createRoute } from '@hono/zod-openapi';
import z from 'zod';

const EpisodesSchema = z.object({
  sub: z.number(),
  dub: z.number(),
  eps: z.number(),
});

const BasicAnimeSchema = z.object({
  title: z.string().nullable(),
  alternativeTitle: z.string().nullable(),
  id: z.string().nullable(),
  poster: z.string().nullable(),
});

const AnimeItemSchema = BasicAnimeSchema.extend({
  episodes: EpisodesSchema,
  rank: z.number().optional(),
  type: z.string().nullable().optional(),
  quality: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  aired: z.string().nullable().optional(),
  synopsis: z.string().nullable().optional(),
});

const TopTenItemSchema = BasicAnimeSchema.extend({
  episodes: EpisodesSchema,
  rank: z.number().optional(),
});

const schema = z.object({
  success: z.boolean(),
  data: z.object({
    source: z.string(),
    spotlight: z.array(AnimeItemSchema),
    trending: z.array(AnimeItemSchema),
    upcoming: z.array(AnimeItemSchema),
    newAiring: z.array(AnimeItemSchema),
    newairing: z.array(AnimeItemSchema),
    recentlyUpdated: z.array(AnimeItemSchema),
    newEpisode: z.array(AnimeItemSchema),
    newepisode: z.array(AnimeItemSchema),
    latestEpisode: z.array(AnimeItemSchema),
    newAdded: z.array(AnimeItemSchema),
    mostPopular: z.array(AnimeItemSchema),
    mostFavorite: z.array(AnimeItemSchema),
    latestCompleted: z.array(AnimeItemSchema),
    topTen: z.object({
      today: z.array(TopTenItemSchema),
      week: z.array(TopTenItemSchema),
      month: z.array(TopTenItemSchema),
    }),
    genres: z.array(z.string()),
  }),
});

const mainSchema = createRoute({
  method: 'get',
  path: '/main',
  responses: {
    200: {
      content: {
        'application/json': {
          schema,
        },
      },
    },
  },
  description: 'Retrieve Kaido homepage data including spotlight, trending, airing, updates, and new episodes.',
});

export default mainSchema;

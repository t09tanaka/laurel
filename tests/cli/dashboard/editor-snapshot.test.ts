import { describe, expect, test } from 'bun:test';
import {
  buildFrontmatter,
  emptyEditorSnapshot,
  snapshotFromFrontmatter,
  snapshotFromItem,
} from '../../../src/cli/dashboard/web/lib/editor-snapshot.ts';

describe('snapshotFromItem — posts/pages', () => {
  test('captures post frontmatter into the snapshot shape', () => {
    const snap = snapshotFromItem('posts', {
      slug: 'hello',
      body: '# Hello',
      frontmatter: {
        title: 'Hello world',
        status: 'draft',
        feature_image: '/content/images/cover.jpg',
        feature_image_alt: 'cover',
        feature_image_caption: 'a caption',
      },
    });
    expect(snap.title).toBe('Hello world');
    expect(snap.status).toBe('draft');
    expect(snap.featureImage).toBe('/content/images/cover.jpg');
    expect(snap.featureImageAlt).toBe('cover');
    expect(snap.featureImageCaption).toBe('a caption');
    expect(snap.body).toBe('# Hello');
    // Taxonomy fields are present but blank for posts.
    expect(snap.bio).toBe('');
    expect(snap.description).toBe('');
    expect(snap.website).toBe('');
    expect(snap.accentColor).toBe('');
  });

  test('falls back to published status when frontmatter omits it', () => {
    const snap = snapshotFromItem('pages', {
      slug: 'about',
      body: '',
      frontmatter: { title: 'About' },
    });
    expect(snap.status).toBe('published');
  });
});

describe('snapshotFromItem — authors', () => {
  test('reads name/bio/website/location and prefers cover_image then profile_image', () => {
    const snap = snapshotFromItem('authors', {
      slug: 'honeybee',
      body: '',
      frontmatter: {
        slug: 'honeybee',
        name: 'Honeybee',
        bio: 'Resident technical writer covering build systems.',
        website: 'https://example.com/honeybee',
        location: 'Internet',
        profile_image: '/content/images/profile.svg',
      },
    });
    expect(snap.title).toBe('Honeybee');
    expect(snap.slug).toBe('honeybee');
    expect(snap.bio).toBe('Resident technical writer covering build systems.');
    expect(snap.website).toBe('https://example.com/honeybee');
    expect(snap.location).toBe('Internet');
    expect(snap.featureImage).toBe('/content/images/profile.svg');
  });

  test('prefers cover_image when both are present', () => {
    const snap = snapshotFromItem('authors', {
      slug: 'casper',
      body: '',
      frontmatter: {
        name: 'Casper',
        cover_image: '/content/images/cover.svg',
        profile_image: '/content/images/profile.svg',
      },
    });
    expect(snap.featureImage).toBe('/content/images/cover.svg');
  });
});

describe('snapshotFromItem — tags', () => {
  test('reads name/description/accent_color/feature_image', () => {
    const snap = snapshotFromItem('tags', {
      slug: 'news',
      body: '',
      frontmatter: {
        slug: 'news',
        name: 'News',
        description: 'Announcements and project updates.',
        accent_color: '#ff6f3c',
        feature_image: '/content/images/news.jpg',
      },
    });
    expect(snap.title).toBe('News');
    expect(snap.description).toBe('Announcements and project updates.');
    expect(snap.accentColor).toBe('#ff6f3c');
    expect(snap.featureImage).toBe('/content/images/news.jpg');
  });
});

describe('buildFrontmatter — posts/pages', () => {
  test('writes title/status/feature image and stamps updated_at', () => {
    const base = { title: 'Old', extra: 'kept' };
    const snap = {
      ...emptyEditorSnapshot(),
      title: 'New title',
      status: 'draft',
      featureImage: 'content/images/cover.jpg',
      featureImageAlt: 'alt',
      featureImageCaption: 'cap',
    };
    const fm = buildFrontmatter('posts', base, snap);
    expect(fm.title).toBe('New title');
    expect(fm.status).toBe('draft');
    expect(fm.feature_image).toBe('/content/images/cover.jpg');
    expect(fm.feature_image_alt).toBe('alt');
    expect(fm.feature_image_caption).toBe('cap');
    expect(typeof fm.updated_at).toBe('string');
    expect(fm.extra).toBe('kept');
  });

  test('drops empty optional feature fields from the frontmatter', () => {
    const fm = buildFrontmatter(
      'posts',
      { feature_image: '/x.jpg', feature_image_alt: 'a' },
      {
        ...emptyEditorSnapshot(),
        title: 'T',
      },
    );
    expect('feature_image' in fm).toBe(false);
    expect('feature_image_alt' in fm).toBe(false);
  });
});

describe('buildFrontmatter — authors', () => {
  test('round-trips author fields and preserves unrelated frontmatter keys', () => {
    const base = {
      slug: 'honeybee',
      name: 'Honeybee',
      bio: 'old bio',
      website: 'https://old.example.com',
      twitter: 'honeybee',
      bluesky: 'honeybee.bsky.social',
      mastodon: 'honeybee@hachyderm.io',
    };
    const snap = snapshotFromItem('authors', { slug: 'honeybee', body: '', frontmatter: base });
    snap.bio = 'updated bio';
    snap.website = 'https://new.example.com';
    snap.twitter = '@newhoneybee';
    snap.bluesky = 'new-honeybee.bsky.social';
    snap.mastodon = 'newhoneybee@hachyderm.io';
    snap.featureImage = '/content/images/cover.svg';
    snap.location = 'Tokyo';
    const fm = buildFrontmatter('authors', base, snap);
    expect(fm.name).toBe('Honeybee');
    expect(fm.slug).toBe('honeybee');
    expect(fm.bio).toBe('updated bio');
    expect(fm.website).toBe('https://new.example.com');
    expect(fm.cover_image).toBe('/content/images/cover.svg');
    expect(fm.location).toBe('Tokyo');
    expect(fm.twitter).toBe('@newhoneybee');
    expect(fm.bluesky).toBe('new-honeybee.bsky.social');
    expect(fm.mastodon).toBe('newhoneybee@hachyderm.io');
    // No stray updated_at on taxonomy frontmatter.
    expect('updated_at' in fm).toBe(false);
  });

  test('removes optional fields when they are blanked out', () => {
    const base = {
      name: 'Casper',
      bio: 'old',
      website: 'https://x',
      location: 'X',
      twitter: 'ghost',
      instagram: 'caspergram',
    };
    const snap = snapshotFromItem('authors', { slug: 'casper', body: '', frontmatter: base });
    snap.bio = '';
    snap.website = '';
    snap.location = '';
    snap.twitter = '';
    snap.instagram = '';
    const fm = buildFrontmatter('authors', base, snap);
    expect('bio' in fm).toBe(false);
    expect('website' in fm).toBe(false);
    expect('location' in fm).toBe(false);
    expect('twitter' in fm).toBe(false);
    expect('instagram' in fm).toBe(false);
  });
});

describe('buildFrontmatter — tags', () => {
  test('round-trips tag fields and preserves visibility', () => {
    const base = {
      slug: 'news',
      name: 'News',
      description: 'Old description.',
      visibility: 'public',
    };
    const snap = snapshotFromItem('tags', { slug: 'news', body: '', frontmatter: base });
    snap.description = 'New description.';
    snap.accentColor = '#ff6f3c';
    snap.featureImage = '/content/images/news.jpg';
    const fm = buildFrontmatter('tags', base, snap);
    expect(fm.name).toBe('News');
    expect(fm.slug).toBe('news');
    expect(fm.description).toBe('New description.');
    expect(fm.accent_color).toBe('#ff6f3c');
    expect(fm.feature_image).toBe('/content/images/news.jpg');
    expect(fm.visibility).toBe('public');
  });
});

describe('snapshotFromFrontmatter — restore round-trip', () => {
  test('reconstructs an author snapshot from a revision frontmatter', () => {
    const fm = {
      name: 'Honeybee',
      slug: 'honeybee',
      bio: 'Resident writer.',
      website: 'https://example.com',
    };
    const snap = snapshotFromFrontmatter('authors', fm, '');
    expect(snap.title).toBe('Honeybee');
    expect(snap.bio).toBe('Resident writer.');
    expect(snap.website).toBe('https://example.com');
  });
});

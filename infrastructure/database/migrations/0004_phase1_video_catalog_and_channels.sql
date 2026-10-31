-- =============================================================================
-- MIGRATION 0004: VIDEO CHANNELS, VIDEO CATALOG METADATA & RELATIONSHIPS
-- Target Engine: PostgreSQL 16
-- Phase: 1 Video Platform Readiness (Task 1.1A Foundational Catalog)
-- =============================================================================

-- 1. Video Channels Table
CREATE TABLE IF NOT EXISTS video_channels (
  channel_id VARCHAR(64) PRIMARY KEY,
  creator_id VARCHAR(64) REFERENCES creator_accounts(creator_id) ON DELETE SET NULL,
  user_id VARCHAR(64) REFERENCES users(user_id) ON DELETE CASCADE,
  channel_handle VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  banner_url TEXT,
  subscriber_count BIGINT NOT NULL DEFAULT 0 CHECK (subscriber_count >= 0),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_channels_creator ON video_channels(creator_id);
CREATE INDEX IF NOT EXISTS idx_video_channels_user ON video_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_video_channels_handle ON video_channels(channel_handle);

-- 2. Video Categories Table
CREATE TABLE IF NOT EXISTS video_categories (
  category_id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  slug VARCHAR(64) NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Baseline Content Categories
INSERT INTO video_categories (category_id, name, slug, description) VALUES
  ('cat_entertainment', 'Entertainment', 'entertainment', 'General entertainment, comedy, and shows'),
  ('cat_gaming', 'Gaming', 'gaming', 'Gameplay, walkthroughs, and gaming culture'),
  ('cat_music', 'Music', 'music', 'Original music releases, performances, and audio cinema'),
  ('cat_education', 'Education', 'education', 'Technical tutorials, lectures, and guides'),
  ('cat_technology', 'Technology', 'technology', 'Hardware, engineering, open source, and software architecture'),
  ('cat_news', 'News & Society', 'news', 'Global reporting, civic updates, and cultural commentary'),
  ('cat_lifestyle', 'Lifestyle', 'lifestyle', 'Vlogs, fitness, design, and culture'),
  ('cat_ai_creative', 'AI & Creative Studio', 'ai-creative', 'AI cinema, generative video workflows, and creative tooling')
ON CONFLICT (category_id) DO NOTHING;

-- 3. Core Videos Catalog Table
CREATE TABLE IF NOT EXISTS videos (
  video_id VARCHAR(64) PRIMARY KEY,
  channel_id VARCHAR(64) NOT NULL REFERENCES video_channels(channel_id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id VARCHAR(64) REFERENCES video_categories(category_id) ON DELETE SET NULL,
  video_format VARCHAR(32) NOT NULL DEFAULT 'STANDARD' CHECK (
    video_format IN ('STANDARD', 'SHORT', 'LIVE_REPLAY', 'PREMIERE')
  ),
  visibility VARCHAR(32) NOT NULL DEFAULT 'PUBLIC' CHECK (
    visibility IN ('PUBLIC', 'UNLISTED', 'SUBSCRIBERS_ONLY', 'PRIVATE', 'AGE_RESTRICTED')
  ),
  processing_status VARCHAR(32) NOT NULL DEFAULT 'READY' CHECK (
    processing_status IN ('UPLOADING', 'PROCESSING', 'READY', 'FAILED')
  ),
  playback_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  resolution_height INTEGER NOT NULL DEFAULT 1080 CHECK (resolution_height >= 0),
  aspect_ratio VARCHAR(16) NOT NULL DEFAULT '16:9',
  view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  like_count BIGINT NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  dislike_count BIGINT NOT NULL DEFAULT 0 CHECK (dislike_count >= 0),
  comment_count BIGINT NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  is_age_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  published_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos(visibility);
CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category_id);
CREATE INDEX IF NOT EXISTS idx_videos_format ON videos(video_format);
CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at_iso DESC);

-- 4. Video Tags Table
CREATE TABLE IF NOT EXISTS video_tags (
  tag_id VARCHAR(64) PRIMARY KEY,
  tag_name VARCHAR(64) NOT NULL UNIQUE,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_tags_name ON video_tags(tag_name);

-- 5. Video Tag Mappings (Relational Association)
CREATE TABLE IF NOT EXISTS video_tag_mappings (
  video_id VARCHAR(64) NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  tag_id VARCHAR(64) NOT NULL REFERENCES video_tags(tag_id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_video_tag_mappings_tag ON video_tag_mappings(tag_id);

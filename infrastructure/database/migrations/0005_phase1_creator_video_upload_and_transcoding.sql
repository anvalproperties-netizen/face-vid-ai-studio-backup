-- =============================================================================
-- MIGRATION 0005: SECURE CREATOR VIDEO UPLOADS, TRANSCODING & RENDITIONS
-- Target Engine: PostgreSQL 16
-- Phase: 1 Video Platform Readiness (Task 1.3A Creator Video Upload Architecture)
-- =============================================================================

-- 1. Video Upload Sessions Table
CREATE TABLE IF NOT EXISTS video_upload_sessions (
  session_id VARCHAR(64) PRIMARY KEY,
  creator_id VARCHAR(64) NOT NULL REFERENCES creator_accounts(creator_id) ON DELETE CASCADE,
  channel_id VARCHAR(64) NOT NULL REFERENCES video_channels(channel_id) ON DELETE CASCADE,
  video_id VARCHAR(64) REFERENCES videos(video_id) ON DELETE SET NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10737418240),
  mime_type VARCHAR(64) NOT NULL CHECK (
    mime_type IN ('video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska')
  ),
  sha256_checksum VARCHAR(64),
  staging_storage_bucket VARCHAR(128) NOT NULL DEFAULT 'face-vid-staging-private',
  staging_object_path TEXT NOT NULL,
  signed_upload_url TEXT NOT NULL,
  resumable_session_uri TEXT,
  upload_status VARCHAR(32) NOT NULL DEFAULT 'INITIATED' CHECK (
    upload_status IN (
      'INITIATED',
      'UPLOADING',
      'UPLOADED',
      'MALWARE_SCANNING',
      'MEDIA_VALIDATING',
      'TRANSCODING',
      'READY_FOR_PUBLICATION',
      'PUBLISHED',
      'FAILED',
      'EXPIRED',
      'ABORTED'
    )
  ),
  malware_scan_status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (
    malware_scan_status IN ('PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'BYPASSED_DEV')
  ),
  media_validation_status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (
    media_validation_status IN ('PENDING', 'VALIDATING', 'VALID', 'INVALID_CONTAINER', 'UNSUPPORTED_CODEC')
  ),
  transcoding_status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (
    transcoding_status IN ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')
  ),
  visibility_choice VARCHAR(32) NOT NULL DEFAULT 'PUBLIC' CHECK (
    visibility_choice IN ('PUBLIC', 'UNLISTED', 'SUBSCRIBERS_ONLY', 'PRIVATE', 'AGE_RESTRICTED')
  ),
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id VARCHAR(64) REFERENCES video_categories(category_id) ON DELETE SET NULL,
  video_format VARCHAR(32) NOT NULL DEFAULT 'STANDARD' CHECK (
    video_format IN ('STANDARD', 'SHORT', 'LIVE_REPLAY', 'PREMIERE')
  ),
  tags TEXT[] NOT NULL DEFAULT '{}',
  extracted_thumbnail_url TEXT,
  failure_reason TEXT,
  expires_at_iso TIMESTAMPTZ NOT NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_creator ON video_upload_sessions(creator_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_channel ON video_upload_sessions(channel_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON video_upload_sessions(upload_status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires ON video_upload_sessions(expires_at_iso);

-- 2. Video Transcoding Renditions Table
CREATE TABLE IF NOT EXISTS video_transcode_renditions (
  rendition_id VARCHAR(64) PRIMARY KEY,
  video_id VARCHAR(64) NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  resolution_height INTEGER NOT NULL CHECK (resolution_height IN (360, 480, 720, 1080, 1440, 2160)),
  bitrate_kbps INTEGER NOT NULL CHECK (bitrate_kbps > 0),
  codec VARCHAR(32) NOT NULL DEFAULT 'h264',
  container VARCHAR(32) NOT NULL DEFAULT 'mp4',
  stream_url TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcode_renditions_video ON video_transcode_renditions(video_id);
CREATE INDEX IF NOT EXISTS idx_transcode_renditions_resolution ON video_transcode_renditions(resolution_height);

-- 3. Video Processing Jobs Table (BullMQ Pipeline Integration)
CREATE TABLE IF NOT EXISTS video_processing_jobs (
  job_id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL REFERENCES video_upload_sessions(session_id) ON DELETE CASCADE,
  queue_name VARCHAR(64) NOT NULL DEFAULT 'facevid_video_transcoding',
  bullmq_job_id VARCHAR(128),
  step VARCHAR(32) NOT NULL CHECK (
    step IN (
      'STAGING_VERIFY',
      'VIRUS_SCAN',
      'CONTAINER_VALIDATE',
      'THUMBNAIL_EXTRACT',
      'HLS_DASH_TRANSCODE',
      'READY_FINALIZE'
    )
  ),
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_session ON video_processing_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_step ON video_processing_jobs(step);

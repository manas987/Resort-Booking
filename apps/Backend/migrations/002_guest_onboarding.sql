-- Existing accounts keep access; new verified identities complete phone/name onboarding.
ALTER TABLE users ADD COLUMN onboarding_complete boolean NOT NULL DEFAULT true;

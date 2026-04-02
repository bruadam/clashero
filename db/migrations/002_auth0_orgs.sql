ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS auth0_org_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_auth0_org_id_key
  ON organizations(auth0_org_id)
  WHERE auth0_org_id IS NOT NULL;


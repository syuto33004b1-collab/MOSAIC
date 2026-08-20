begin;

-- Restores the feature-key allow list as a table constraint. It was left out of
-- 20260820090000_role_permissions.sql on the incorrect assumption that array
-- containment is STABLE and therefore unusable in a CHECK. It is IMMUTABLE, and
-- app.integration_clients (scopes) and app.webhook_endpoints (events) already
-- rely on the same pattern.
--
-- The hidden/read-only overlap rule stays in private.apply_role_permissions:
-- the overlap operator has no precedent here, and the apply function is the only
-- writer for this table.
alter table app.role_permissions
  add constraint role_permissions_disabled_features_allowed check (
    disabled_features <@ array[
      'searchScenes',
      'savedReports',
      'profileRequests',
      'opportunities',
      'favorites'
    ]::text[]
  );

commit;

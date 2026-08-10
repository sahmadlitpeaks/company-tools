# Backup recovery (CLI)

The application creates ZIP archives containing `database.dump` and `media.tar.gz`.
There is intentionally no live restore button.

1. Stop the backend and frontend: `docker compose stop backend frontend`.
2. Extract the selected ZIP outside the repository.
3. Recreate the local database, then restore it:
   `docker compose exec -T db dropdb --force -U platform platform`
   `docker compose exec -T db createdb -U platform platform`
   `docker cp database.dump company-tools-db-1:/tmp/database.dump`
   `docker compose exec -T db pg_restore -U platform -d platform --no-owner /tmp/database.dump`
4. Extract `media.tar.gz` into the Docker `media` volume (or the configured
   `MEDIA_ROOT`) while the backend is stopped.
5. Run `docker compose run --rm --no-deps backend alembic upgrade head`.
6. Start the stack with `docker compose up -d`, check `/health`, then inspect
   representative database records and uploaded files.

Always retain the original archive and verify its SHA-256 checksum before recovery.

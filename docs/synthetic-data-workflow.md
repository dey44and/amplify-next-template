# Synthetic Data Workflow (Reversible)

This project includes a reversible workflow for testing charts with synthetic data.

## Commands

- Backup current database snapshot:

```bash
npm run db:backup -- --out .tmp/db-backups/my-backup.json
```

- Seed synthetic attempts (cohort + optional user line):

```bash
npm run db:seed -- --user-sub <your-cognito-sub> --weeks 14 --cohort-size 28 --admission-types "Computer Engineering,Mathematics"
```

- One-step demo cycle (backup + seed):

```bash
npm run db:demo -- --user-sub <your-cognito-sub>
```

- Restore exact snapshot:

```bash
npm run db:restore -- --backup .tmp/db-backups/my-backup.json
```

## Notes

- The scripts read region and API id from `amplify_outputs.json`.
- You can override AppSync API id with `--api-id <id>` if local outputs are stale.
- `restore` clears and repopulates model tables from the backup snapshot.
- If `--user-sub` is not passed, the script tries to infer it from `UserProfile`.
- If multiple user profiles exist, pass `--user-sub` explicitly for predictable personal trend lines.
- If your role cannot call `appsync:ListDataSources`, the script falls back to table names with format `<Model>-<ApiId>-NONE`.
- If your environment uses a different suffix, pass `--table-suffix <suffix>`.

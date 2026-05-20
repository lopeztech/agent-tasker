output "firestore_database_name" {
  description = "Logical name of the Firestore database — always `(default)` for the project's primary database."
  value       = google_firestore_database.default.name
}

output "firestore_location_id" {
  description = "Location the Firestore database was provisioned in. Cannot be changed after creation."
  value       = google_firestore_database.default.location_id
}

output "jwks_bucket_name" {
  description = "Name of the GCS bucket holding the JWKS document. Used by the coordinator's publish helper when rotating keys."
  value       = google_storage_bucket.jwks.name
}

output "jwks_public_url" {
  description = "Stable public URL each agent's verifier fetches to read coordinator public keys. Object `jwks.json` is published out-of-band by the coordinator at startup / key rotation."
  value       = "https://storage.googleapis.com/${google_storage_bucket.jwks.name}/jwks.json"
}

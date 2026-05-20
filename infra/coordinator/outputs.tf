output "firestore_database_name" {
  description = "Logical name of the Firestore database — always `(default)` for the project's primary database."
  value       = google_firestore_database.default.name
}

output "firestore_location_id" {
  description = "Location the Firestore database was provisioned in. Cannot be changed after creation."
  value       = google_firestore_database.default.location_id
}

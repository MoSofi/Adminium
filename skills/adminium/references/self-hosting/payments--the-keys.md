<!-- produced from apps/docs/src/content/docs/self-hosting/payments.md § The keys; do not edit -->

# Payments on your server: The keys

Payment keys are saved per mode (test and live) and kept in the add-on's encrypted credentials in
the meta store, under the key derived from `ADMINIUM_SECRET`. Keep that secret with your backups:
without it the keys cannot be read, and you would paste them again.

Several Adminium processes can share one meta store. The safety check that finds payments whose
webhook went missing runs once per service and mode, whichever process gets it.

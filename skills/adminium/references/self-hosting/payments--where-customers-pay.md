<!-- produced from apps/docs/src/content/docs/self-hosting/payments.md § Where customers pay; do not edit -->

# Payments on your server: Where customers pay

**Studio → Payments → Pay page → Where customers pay** chooses the address in every pay link: your
staff address, or one of your customer addresses ([an app on its own domain](https://docs.adminium.dev/self-hosting/app-domains/)). A customer address
is better when you would rather not show the staff address to the public. The webhook uses the same
address. Until you choose one, both use this server's public address (**Address in email links** in
Senders).

A customer address serves only what a customer needs. For payments that is `/pay/…` (the pay page,
its files and its own API) and `/api/v1/payments/webhook/…`. Your proxy must let both through.

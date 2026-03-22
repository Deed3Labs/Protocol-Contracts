FROM blockscout/blockscout:latest

# Run DB migrations on boot, then start the Blockscout backend.
CMD ["sh", "-c", "bin/blockscout eval \"Elixir.Explorer.ReleaseTasks.create_and_migrate()\" && bin/blockscout start"]

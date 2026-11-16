# SSH keys for machines

Members keep their SSH public keys on `/keys`. A service reads the keys a member turned on for it there, one for each machine they log in from, or their first key when they turned none on. A service is somewhere members log in: a jump host, a platform. Portal admins make services on `/keys/services`; each has a read key its machines fetch the keys with.

## Read a service's keys

```sh
# every member allowed in, as authorized_keys text
curl -H "Authorization: Bearer wkk_…" "https://portal.winlab.tw/api/ssh-keys/services/<slug>?format=text"
# one member
curl -H "Authorization: Bearer wkk_…" "https://portal.winlab.tw/api/ssh-keys/services/<slug>/<username>?format=text"
```

Without `?format=text` (or `Accept: text/plain`) the answer is JSON: `[{"username": "alice", "keys": ["ssh-ed25519 AAAA… alice"]}]`, or one such object for one member. Every answer carries an `ETag`; send it back as `If-None-Match` to get `304` while nothing changed.

| Status | Meaning |
|--------|---------|
| `401` | No read key, or one the portal does not know (replaced or its service deleted) |
| `403` | The read key belongs to another service |
| `503` | Keycloak could not say who is a member: keep the list read last |

Who is served is decided on every read: the member's Keycloak account must be enabled, an open service takes current lab members (not alumni), and any other service only the members an admin granted. A grant taken away or a key deleted is gone on the next read; an account disabled in Keycloak within 10 minutes.

## Set up a jump host

`portal-keys` is an `AuthorizedKeysCommand`: sshd asks it on each login, it asks the portal, and it keeps the answer so logins still work while the portal is down.

```sh
sudo useradd --system --shell /usr/sbin/nologin portal-keys
sudo install -m 755 portal-keys /usr/local/bin/portal-keys
sudo install -d -o portal-keys -m 700 /etc/portal-keys /var/cache/portal-keys
printf 'SERVICE=b09\nSHARED="p4user"\n' | sudo -u portal-keys tee /etc/portal-keys/env
sudo -u portal-keys sh -c 'umask 077; cat > /etc/portal-keys/token'   # paste the read key, then Ctrl-D
printf 'AuthorizedKeysCommand /usr/local/bin/portal-keys %%u\nAuthorizedKeysCommandUser portal-keys\n' |
  sudo tee /etc/ssh/sshd_config.d/portal-keys.conf
sudo sshd -t && sudo systemctl reload ssh
```

`SHARED` lists the accounts every member of the service logs in to (B09's `p4user`); no other account is answered. Add `OWN=yes` to also let a member in to the local account that has their username. It skips accounts under uid 1000, but an account such as `ubuntu` or `admin` is then open to whoever holds that username in Keycloak, so set it only on a machine whose accounts are all members'. Check a login with a key before turning `PasswordAuthentication` off.

A machine that cannot reach the portal serves the list it read last for one day (`MAX_AGE`, in minutes, in `/etc/portal-keys/env`), then nobody. To cut a member off during an outage, delete `/var/cache/portal-keys/<account>`. When the portal refuses the read key (`401`, `403`), the copy is deleted and nobody gets in until the machine holds a working key.

## Read a member's keys

Any member can read another member's public keys, with an API key allowed into SSH 金鑰 (`/api-keys`) or the `list_member_ssh_keys` tool. Such a key only reads: adding a key or picking one for a service takes the page or MCP.

```sh
curl -H "Authorization: Bearer wak_…" "https://portal.winlab.tw/api/ssh-keys/members/<username>?format=text" >> ~/.ssh/authorized_keys
```

Without `format=text` the answer is JSON, and `details` says for each key its label, the machine that holds it and what the member says it is for.

## Carrel

Carrel reads `/api/ssh-keys/services/carrel/<username>` for each member of a tenant with its own read key. Tenant membership stays in Carrel; the portal answers per member.

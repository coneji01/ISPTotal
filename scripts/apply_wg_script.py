import paramiko
import time

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('10.10.11.2', username='admin', password='F1tfdrsx132022', look_for_keys=False, allow_agent=False, timeout=10)

# Clean everything
for cmd in ['/ip address remove [find interface=wg-isptotal]', 
            '/interface wireguard peers remove [find]',
            '/interface wireguard remove wg-isptotal']:
    stdin, stdout, stderr = client.exec_command(cmd)
    time.sleep(0.3)
    result = stdout.read().decode() + stderr.read().decode()
    if result.strip():
        print(f'Clean: {result.strip()[:100]}')

# Now execute command by command directly
commands = [
    '/interface wireguard add name=wg-isptotal listen-port=13231 mtu=1420 comment="ISPTotal - Router Cliente Prueba"',
    '/ip address add address=10.10.10.2/24 interface=wg-isptotal comment="IP Tunel ISPTotal - Router Cliente Prueba"',
    '/interface wireguard peers add interface=wg-isptotal public-key="kr3scNOcnG+8Oyq1lX6X9r/VBgvT0Qo6Iq1UkhlWihA=" endpoint-address=38.159.230.92 endpoint-port=13231 allowed-address=10.10.10.0/24 persistent-keepalive=25s comment="Peer: Servidor ISPTotal"',
    '/ip route add dst-address=10.10.10.0/24 gateway=wg-isptotal comment="Ruta ISPTotal"',
    '/ip firewall filter add chain=input protocol=udp dst-port=13231 action=accept comment="allow-wg-isptotal"',
    '/ip firewall filter add chain=input in-interface=wg-isptotal action=accept comment="allow-wg-isptotal-in"',
    '/ip firewall filter add chain=forward in-interface=wg-isptotal action=accept comment="fwd-wg-isptotal"',
    '/ip firewall filter add chain=forward out-interface=wg-isptotal action=accept comment="fwd-wg-isptotal-out"',
    '/ip firewall nat add chain=srcnat out-interface=wg-isptotal action=masquerade comment="masq-wg-isptotal"',
]

for cmd in commands:
    print(f'  > {cmd[:80]}...')
    stdin, stdout, stderr = client.exec_command(cmd)
    time.sleep(0.5)
    result = stdout.read().decode() + stderr.read().decode()
    if result.strip():
        print(f'    -> {result.strip()[:200]}')

print('\n=== Verifying ===')
stdin, stdout, stderr = client.exec_command('/interface wireguard print')
print('WG:', stdout.read().decode())

stdin, stdout, stderr = client.exec_command('/interface wireguard peers print')
print('Peers:', stdout.read().decode())

stdin, stdout, stderr = client.exec_command('/ip address print where interface=wg-isptotal')
print('IP:', stdout.read().decode())

# Get public key
stdin, stdout, stderr = client.exec_command('/interface wireguard print detail where name=wg-isptotal')
detail = stdout.read().decode()
print('Detail:', detail)

client.close()

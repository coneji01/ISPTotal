#!/usr/bin/env python3
"""Ping a VPN router via the MikroTik borde's SSH."""
import paramiko
import sys
import json
import re

HOST = "10.0.0.1"
PORT = 22
USER = "admin"
PASSWORD="F1tfdrsx132022"
INTERFACE = "VPN-Total-ISP"

def main():
    global PASSWORD
    
    if len(sys.argv) < 2:
        print(json.dumps({"connected": 0, "error": "No IP provided"}))
        sys.exit(1)
    
    target_ip = sys.argv[1]
    
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, PORT, USER, PASSWORD, timeout=10, allow_agent=False, look_for_keys=False)
        
        cmd = f'/ping {target_ip} count=5 interval=0.1'
        stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
        output = stdout.read().decode('utf-8', errors='replace')
        client.close()
        
        # Parse output: look for "received=N" or "packet loss"
        # Typical output: "round-trip min/avg/max = 0/0/1 ms" or "0 packets received"
        sent_match = re.search(r'(\d+)\s+packets transmitted', output)
        received_match = re.search(r'(\d+)\s+(packets\s+)?received', output)
        loss_match = re.search(r'(\d+)\s*% loss', output)
        
        sent = int(sent_match.group(1)) if sent_match else 5
        received = int(received_match.group(1)) if received_match else 0
        
        connected = 1 if received > 0 else 0
        
        print(json.dumps({"connected": connected, "sent": sent, "received": received, "output": output[:200]}))
    except Exception as e:
        print(json.dumps({"connected": 0, "error": str(e)}))

if __name__ == "__main__":
    main()

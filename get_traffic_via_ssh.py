#!/usr/bin/env python3
"""Obtiene tráfico WAN via SSH desde el MikroTik borde."""
import paramiko
import sys
import json
import re

HOST = "10.0.0.1"
PORT = 22
USER = "admin"
PASSWORD = ""  # Se pasa como argumento o se pide
INTERFACE = "ether1"

def main():
    global PASSWORD, INTERFACE
    
    if len(sys.argv) > 1:
        PASSWORD = sys.argv[1]
    if len(sys.argv) > 2:
        INTERFACE = sys.argv[2]
    
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, PORT, USER, PASSWORD, timeout=10, allow_agent=False, look_for_keys=False)
        
        cmd = f'/interface monitor-traffic {INTERFACE} once'
        stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
        output = stdout.read().decode('utf-8', errors='replace')
        client.close()
        
        # Parse output: look for rx-bits-per-second and tx-bits-per-second
        # Output format:
        #   name: ether1
        #   rx-bits-per-second: 123456
        #   tx-bits-per-second: 789012
        rx_match = re.search(r'rx-bits-per-second:\s*(\d+)', output)
        tx_match = re.search(r'tx-bits-per-second:\s*(\d+)', output)
        
        bps_in = int(rx_match.group(1)) if rx_match else 0
        bps_out = int(tx_match.group(1)) if tx_match else 0
        
        print(json.dumps({"success": True, "bps_in": bps_in, "bps_out": bps_out}))
    except Exception as e:
        print(json.dumps({"success": False, "message": str(e)}))

if __name__ == "__main__":
    main()

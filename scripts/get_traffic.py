#!/usr/bin/env python3
"""Obtiene tráfico WAN via SSH desde el MikroTik borde."""
import paramiko
import sys
import json
import re

HOST = "10.0.0.1"
PORT = 22
USER = "admin"
PASSWORD = "F1tfdrsx132022"

def main():
    interface = sys.argv[1] if len(sys.argv) > 1 else "ether1"
    
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, PORT, USER, PASSWORD, timeout=10, allow_agent=False, look_for_keys=False)
        
        cmd = f'/interface monitor-traffic {interface} once'
        stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
        output = stdout.read().decode('utf-8', errors='replace')
        client.close()
        
        # Parse rx-bits-per-second and tx-bits-per-second
        # Can be "16.8kbps" or "123456" or "0bps"
        rx_match = re.search(r'rx-bits-per-second:\s*([\d.]+)(k|M|G|)bps', output)
        tx_match = re.search(r'tx-bits-per-second:\s*([\d.]+)(k|M|G|)bps', output)
        
        def to_bps(val, unit):
            val = float(val)
            if unit == 'k': return int(val * 1000)
            if unit == 'M': return int(val * 1000000)
            if unit == 'G': return int(val * 1000000000)
            return int(val)
        
        bps_in = to_bps(*rx_match.groups()) if rx_match else 0
        bps_out = to_bps(*tx_match.groups()) if tx_match else 0
        
        print(json.dumps({"success": True, "bps_in": bps_in, "bps_out": bps_out}))
    except Exception as e:
        print(json.dumps({"success": False, "message": str(e)}))

if __name__ == "__main__":
    main()

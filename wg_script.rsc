# ============================================
# Script de conexion WireGuard - ISPTotal
# Generado: 2026-06-07
# Router: Router Cliente Prueba
# ============================================
#
# DATOS DEL SERVIDOR (MikroTik Borde):
#   Router: CCR2116-ROUTER-BORDER-JOELWIFI
#   Interfaz WG: VPN-Total-ISP
#   Public Key: kr3scNOcnG+8Oyq1lX6X9r/VBgvT0Qo6Iq1UkhlWihA=
#   Endpoint: 38.159.230.92:13231
#   Red Tunel: 10.10.10.0/24
#   IP Servidor: 10.10.10.1
#
# 1. Crear interfaz WireGuard en el MikroTik del cliente
/interface wireguard add name=wg-isptotal listen-port=13231 mtu=1420 comment="ISPTotal - Router Cliente Prueba"

# 2. Asignar IP del tunel a la interfaz
/ip address add address=10.10.10.2/24 interface=wg-isptotal comment="IP Tunel ISPTotal - Router Cliente Prueba"

# 3. Agregar peer: MikroTik Borde (servidor ISPTotal)
#    El MikroTik borde escucha en 38.159.230.92:13231
/interface wireguard peers add \
    interface=wg-isptotal \
    public-key="kr3scNOcnG+8Oyq1lX6X9r/VBgvT0Qo6Iq1UkhlWihA=" \
    endpoint-address=38.159.230.92 \
    endpoint-port=13231 \
    allowed-address=10.10.10.0/24 \
    persistent-keepalive=25s \
    comment="Peer: Servidor ISPTotal (hka0axdjnve.sn.mynetname.net)"

# 4. Ruta hacia el servidor ISPTotal via el tunel
/ip route add dst-address=10.10.10.0/24 gateway=wg-isptotal comment="Ruta ISPTotal" 

# 5. Reglas de Firewall
/ip firewall filter add chain=input protocol=udp dst-port=13231 action=accept comment="allow-wg-isptotal" 
/ip firewall filter add chain=input in-interface=wg-isptotal action=accept comment="allow-wg-isptotal-in" 
/ip firewall filter add chain=forward in-interface=wg-isptotal action=accept comment="fwd-wg-isptotal" 
/ip firewall filter add chain=forward out-interface=wg-isptotal action=accept comment="fwd-wg-isptotal-out" 

# 6. NAT para acceso desde el servidor a la red interna del cliente
/ip firewall nat add chain=srcnat out-interface=wg-isptotal action=masquerade comment="masq-wg-isptotal" 

# 7. Permitir acceso API MikroTik desde el tunel ISPTotal
/ip service set api address=10.10.10.0/24,127.0.0.0/8 
/ip service set api-ssl address=10.10.10.0/24,127.0.0.0/8 
/ip service set winbox address=10.10.10.0/24,127.0.0.0/8 

# 8. (Opcional) Crear usuario API para gestion automatica
/user add name=isptotal group=full password=isptotal_wg_$(/system clock get date) disabled=no comment="ISPTotal API Access" 

# ============================================
# VERIFICACION:
#   /interface wireguard print
#   /interface wireguard peers print
#   /ping 10.10.10.1 count=5
#   /tool traceroute 10.10.10.1
# ============================================
:put "Script finalizado. Verifica con /ping 10.10.10.1 count=5"


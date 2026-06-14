# ZTE C300 OLT - Comandos de Referencia

Fuentes: GitHub (tyotrader/olt-zte-provisioning), networkingfromzero, SmartOLT, langzhichina

## 🔍 COMANDOS SHOW (Consultas)

### Estado General del Sistema
```
show version                      # Versión del software
show system uptime               # Tiempo encendida
show system resource             # Recursos del sistema
show processor                   # CPU y memoria por tarjeta
show temperature                 # Temperatura por slot
show card                        # Estado de tarjetas (slots)
show users                       # Usuarios conectados
```

### ONUs - Listados y Estados
```
show gpon onu state              # Estado de TODAS las ONUs (ya implementado)
show gpon onu state 1/2/1       # Estado de ONUs en un puerto específico
show gpon onu uncfg              # ONUs no configuradas (ya implementado)
show gpon onu profile            # TODAS las ONUs registradas con perfiles
show gpon onu by-sn <SN>        # Buscar ONU por Serial Number
show onu-type                    # Tipos de ONU soportados
```

### ONUs - Detalle Individual
```
show gpon onu detail-info gpon-onu_1/2/1:1    # Info completa + histórico
show gpon remote-onu optical-info gpon-onu_1/2/1:1  # Señal óptica
show gpon remote-onu distance gpon-onu_1/2/1:1      # Distancia
show gpon remote-onu measure-result gpon-onu_1/2/1:1 # Medición
show gpon remote-onu equip gpon-onu_1/2/1:1         # Equipo/Versión
show gpon remote-onu ip-host gpon-onu_1/2/1:1       # IP del ONU
show gpon onu base-info gpon-onu_1/2/1:1            # Info base
show mac gpon onu gpon-onu_1/2/1:1                  # MAC address
show gpon alarm history gpon-onu_1/2/1:1           # Alarmas históricas
show gpon event gpon-onu_1/2/1:1                   # Eventos
```

### Puertos y VLANs
```
show interface gpon-onu_1/2/1:1            # Config del puerto ONU
show interface gpon-onu_1/2/1:1 counter    # Estadísticas
show service-port all                      # Service-ports
show service-port 100                      # Service-port específico
show vlan 100                              # VLAN específica
show vlan summary                          # Resumen de VLANs
show vlan port gpon-onu_1/2/1:1           # VLANs de una ONU
show running-config interface gpon-onu_1/2/1:4  # Config actual de ONU
show onu running config gpon-onu_1/2/1:4        # Config alternativa
show pon power-att gpon-onu_1/2/1:1       # Atenuación óptica
```

### Running Config
```
show running-config                         # Config completa (MUY larga)
show running-config | include gpon-onu      # Solo líneas de ONUs
show running-config | include sn            # Solo líneas con SN
show running-config interface gpon-onu_1/2/1:4  # Config de una ONU
show startup-config                         # Config guardada
```

## ⚙️ COMANDOS DE CONFIGURACIÓN

### Autorizar ONU Nueva
```
configure terminal
interface gpon-olt_1/2/1
onu 1 type auto sn ZTEGDC7946D3
exit
interface gpon-onu_1/2/1:1
tcont 1 profile DATA
gemport 1 name Gem1 tcont 1
exit
service-port 100 gpon-onu_1/2/1:1 gemport 1 user-vlan 200 vlan 200 svlan 200 vport 1
end
write memory
```

### Eliminar ONU
```
configure terminal
interface gpon-olt_1/2/1
no onu 1
exit
end
write memory
```

### Deshabilitar/Habilitar ONU
```
configure terminal
interface gpon-onu_1/2/1:1
shutdown           # Deshabilitar
no shutdown        # Habilitar
exit
```

### Rebootear ONU
```
reboot gpon-onu_1/2/1:1
reboot gpon-onu_1/2/1:1 confirm
restore factory gpon-onu_1/2/1:1   # Reset a fábrica
```

### DHCP / IP en ONU (Routing Mode)
```
interface gpon-onu_1/2/1:1
pppoe 1 nat enable user cliente@isp password clave123
pppoe 1 ip-host 1 respond-ping enable
exit
```

### WiFi en ONU
```
interface gpon-onu_1/2/1:1
wifi enable
ssid NombreRed
wpa2 enable
wpa2 password ClaveWiFi
exit
```

### Perfiles de Tráfico
```
profile tcont DATA type 1 fixed 5000 assured 10000 maximum 50000
traffic-table ip 10 name Data cir 50000 cbs 1000000 pir 1000000 pbs 2000000
show profile tcont
show traffic-table ip
```

## 🔧 MANTENIMIENTO

### Diagnóstico
```
ping gpon-onu_1/2/1:1
ping <IP-address>
traceroute <IP-address>
```

### Debug
```
debug gpon onu gpon-onu_1/2/1:1
no debug gpon onu gpon-onu_1/2/1:1
show debug
```

### Guardar Configuración
```
write memory
copy running-config startup-config
```

## 💡 COMANDOS NUEVOS PARA IMPLEMENTAR

De esta investigación, los comandos más valiosos que aún NO tenemos en el sistema:

| Comando | Utilidad |
|---------|----------|
| `show gpon onu by-sn <SN>` | Encontrar ONU por SN (inverso a detail-info) |
| `show gpon onu profile` | Ver todas las ONUs con perfiles |
| `show running-config interface gpon-onu_X/X/X:X` | Ver config completa de una ONU |
| `reboot gpon-onu_X/X/X:X` | Reiniciar ONU remotamente |
| `show gpon remote-onu equip` | Versión del equipo ONU |
| `show mac gpon onu` | MAC address de la ONU |

## 🔑 NOTAS IMPORTANTES

- Para el SN en bulk: `show running-config | include sn` puede funcionar pero es lento con muchas ONUs
- `show gpon onu by-sn <SN>` es perfecto para buscar una ONU específica
- La ZTE C300 no tiene un comando único que muestre estado + SN de todas las ONUs simultáneamente
- Para operaciones masivas, lo mejor es combinar telnet (estado rápido) + SmartOLT API (nombres/SNs)

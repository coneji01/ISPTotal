# ZTE C300 — Comandos de Gestión vía Telnet

> **Extraído directamente de la OLT C300** (JOEL WIFI) el 10/06/2026.
> Conexión vía SOCKS4 proxy al router core CCR2116 (10.50.255.245:1080), luego Telnet a 192.168.20.80:23.
> Credenciales: `zte` / `zte`

## Conexión

```javascript
// SOCKS4 connect al core (10.50.255.245:1080)
const sock = new net.Socket();
sock.connect(1080, '10.50.255.245');
// SOCKS4 handshake: Buffer [4, 1, port_hi, port_lo, ip0, ip1, ip2, ip3, 0]
```

## Pitfalls

1. **`terminal length 0`** debe ejecutarse DESPUÉS del login, antes de cualquier comando que genere mucho output (evita el paginador `--More--`)
2. **Login detecta `Username:` y `Password:`** aparecen múltiples veces en el buffer. Usar contador de ocurrencias
3. **Comandos espaciados ~2s** — la OLT es lenta. Enviar comandos muy rápido los pierde en el buffer
4. **Timeout** ~30-45s por query. Si hay 3 comandos, una consulta completa toma ~8-10s
5. **Si el túnel SSTP al core se cae**, la OLT no es reachable

---

## 1. Comandos de nivel EXEC (desde `ZXAN#`)

```
auto-update      Auto-update
bfd-stat         Clear bfd statistics
cfm              Connectivity fault management
check            Check the status of the device
clear            Reset functions
clock            Manage the system clock
configure        Enter configuration mode
debug            Debugging functions
diagnose         Enter diagnosis mode
disable          Turn off privileged commands
enable           Turn on privileged commands
end              Exit to privilege mode
exit             Exit from the EXEC
file             File operation
kick-off         Kick off DHCP users
license          License operation
login            Login as a particular user
logout           Exit from the EXEC
manual-backup    Start manual backup
no               Negate a command or set its defaults
package          Package operation
patch            Patch load or unload to version
ping             Send echo messages
ping6            Send IPv6 echo messages
qry              Qry MP is ready to change-over
quit             Quit from the EXEC
reboot           Reboot a shelf
release          Release a resource
remote-unit      RU manual action
renew            Renew a resource
reset-card       Reset a card
reset-subcard    Reset a subcard
restore          Restore factory defaults
show             Show running system information
swap             MP changeover
swapver          Swap MP active version
telnet           Open a telnet connection
telnet6          Open a telnet6 connection
terminal         Set terminal line parameters
trace            Trace route to destination
trace6           Trace route to destination using IPv6
update-boot      Update boot
update-cpld      Set update-cpld flag
update-sub-boot  Update sub boot
user             CLI user commands
who              List users who are logining on
write            Write running configuration to memory
```

---

## 2. Comandos `show <subcomando>` — Lista completa

```
show auto write configuration
  backboard                      Show Backboard
  bcm-config                     Show bcmp configuration
  bfd                            BFD information
  bgp                            BGP information
  bonding                        Show bonding information
  bonding-capability             Show bonding capability information
  bonding-config                 Show bonding config information
  bonding-port-info              show bonding-port-info
  bonding-status                 Show bonding status information
  bridge-dhcp-relay              Show bridge vlan map information
  cable                          Show cable modem information
  card                           Show card information
  card-clock                     Show card clock information
  card-power                     Show cards power
  card-temperature               Show cards temperature
  ces                            Show CES information
  cfm                            Show CFM information
  class-map                      Show class-map configuration
  clients                        Show network access online clients
  clock                          Show the system clock
  cmc                            Show cmc information
  compound-version               Show compound version information
  config-load-fail               Show the error cmd line on loading config
  configuration                  Show radius config information
  control-panel                  Show control panel configure information
  counter                        Show counter information
  cpe-access-list                Show cpe-access-list info
  cpe-access-list-switch         Get cpe-access-list-switch status
  cpu-load-detail                Show cpu load detail
  cputhreshold                   Show CPU threshold information
  crtv-config                    Show crtv configuration
  customer-xconnect              Show created customer xconnect vlan
  datasyn-status                 Show data syn state
  dbglog                         Show debug log switch
  delt                           Show delt information
  dhcp-test                      Show dhcp test result
  dhcpv4-l2-relay-agent          Show dhcpv4-l2-relay-agent information
  dhcpv6-l2-relay-agent          Show dhcpv6-l2-relay-agent information
  dhcpv6-l2-relay-mode           Show dhcpv6-l2-relay-mode information
  diaglog                        Show diaglog information
  diagnostic                     Diagnostic information
  dot1x                          show dot1x
  dsl                            Show dsl information
  dwdm                           show DWDM information
  env-switch                     Show environment switch
  epm                            Show epm config
  epon                           Show EPON config information
  equip-detail                   Show equip detail information
  erps                           (ERPS info)
  eth-switch                     Show eth-switch configuration
  ethernet-oam                   Show Ethernet OAM config information
  ex-switch                      Show external switch
  fan                            Show fan configuration in fan mode
  file                           Show file information
  file-server                    Show file-server
  flowstat                       Show flowstat info
  gpon                           Show GPON information
  gpon-onu-typed                 Show gpon onu typed group information
  hardware-check-status          Show hardware-check-status [slot/all]
  igmp                           Show IGMP global information
  igmp-test                      Show result of igmp-test
  ingress-filter                 Show interface ingress-filter
  inner-port-status              Show inner-port status
  interface                      Display interface property and statistics
  ip                             Show ip info
  ip-service                     Show ip-service information
  ip-source-guard                Show ip-source-guard information
  ipoa                           Show ipoa information
  iptv                           Show information about iptv
  iptv-service-profile           Show multicast profile cfg
  ipv6                           IPv6 information
  ipv6-prefix-length             Show ssp ipv6 prefix length
  isis                           IS-IS routing information
  l2vpn                          L2VPN information
  l2vpn-flow-stat                Show l2vpn flow-stat information
  label                          Label traffic information
  lacp                           LACP information
  last-modify-card               Show the error cmd line on modify slot
  license                        Show license information
  line-configuration             Show the line configuration
  link-mapping                   link-mapping
  lldp                           Show LLDP information
  load-balance                   Show load-balance configuration
  logging                        Show logging information
  loopback-detection             Show loopback-detection Status
  lst                            Show LST configure and status
  mac                            Show mac information from main card
  mac-filter                     MAC-filter
  mac-real-time                  Show mac information from local card
  mac-table                      Display the L2VPN MAC information
  mcast                          Show vpls mcast info
  media-monitor                  Show media-monitor information
  melt                           Show melt information
  mem-fail                       Show memory monitor information
  memthreshold                   Show Memory Threshold
  mld                            Show MLD global information
  mld-test                       Show result of mld-test
  monitor                        Monitor information
  mpls                           Show mpls info
  mpnat                          Show multi-protocol nat information
  msag                           Show msag info
  mutual                         Show mutual information
  muxadpt                        Show muxadpt data
  mvlan-translate                Show mvlan trans info
  nd6                            ND6 information
  ndp-lio                        Show ndp-lio information
  ngpon                          Show PON protection information
  ntp                            Network time protocol
  olt                            Show the information of OLT
  onu                            Show EPON ONU information
  onu-pnp                        Show ONU PNP information
  onu-type                       Show ONU type template information
  onu-type-if                    Show ONU type UNI information
  operator-mode                  (operator mode)
  optical-module                 Show optical-module configuration
  optical-module-alarm-profile   Show optical-module-alarm-profile
  optical-module-class-profile   Show optical-module-class-profile
  optical-module-reserved-class  Show optical-module-reserved-class
  p2p                            Show P2P information
  patch-running                  Show patch information running on card
  patch-saved                    Show patch information stored in mp
  pbit-flowstat                  Show pbit-flowstat info
  perf-brg-if                    Show brg-if performance alarm profile
  perf-eth-if                    Show EthPort performance alarm profile
  perf-eth-olt                   Show OLT ethernet performance alarm profile
  perf-eth-onu                   Show ONU ethernet performance alarm profile
  perf-mac-olt                   Show OLT MAC performance alarm profile
  perf-mac-onu                   Show ONU MAC performance alarm profile
  perf-pw                        Show pseudowire performance alarm profile
  performance                    Show performance statistics data
  pnp                            Show pnp config
  pon                            Show PON information
  port-identification            Show port-identification information
  port-license                   Show port capability
  pppoa-pppoe                    Show pppoa-pppoe information
  pppoe-filter                   Show pppoe-filter information
  pppoe-intermediate-agent       Show pppoe-intermediate-agent information
  pppoe-test                     Show pppoe-test status and result
  privilege                      Show current privilege level
  processor                      Show system processor information
  protection                     Show PON protection information
  protocol-source-ip             Show protocol source IP address
  pw                             Show PW details
  qos                            Show QoS information
  rack                           Show Rack
  radius                         Show radius config
  radius-server                  Show radius-server information
  remote                         Show EPON remote ONU information
  remote-unit                    Show RU
  running-config                 Current operating configuration
  sdisk-status                   Show the sdisk's status
  security                       Show security information
  security-service-profile       Show security profile cfg
  selt                           Show selt information
  service-port                   Show service port configuration
  shdsl                          Show shdsl information
  shelf                          Show Shelf
  snmp                           Show SNMP information
  spanning-tree                  Show spanning-tree information
  ssh                            Show SSH information
  start                          Show start run configure information
  statistics                     Statistics
  status                         Show IMA status information
  sub-version-running            Show sub version running on subboard
  subcard                        Show sub card information
  summer-time                    (summer time)
  supervlan                      Show supervlan information
  switch-board                   Show switch board configure parameter
  sync-status                    Show mainbackup sync status
  syslog                         Show syslog configuration
  system-forwarding-mode         (system forwarding mode)
  system-group                   System information (uptime)
  system-monitor                 Show system-monitor Configure
  tacacs+                        Show tacacs+ config
  task                           Show task information
  tcp                            TCP information
  template                       Show template status information
  terminal                       Show terminal configuration parameters
  this                           Current port configuration
  time                           Show time
  time-range                     Show time-range
  tmpls                          TMPLS information
  traffic-cir                    Show traffic-cir information of pon
  traffic-mirror                 Show traffic-mirror info
  traffic-profile                Show traffic profile information
  traffic-reflect                Show traffic-reflect information
  traffic-statistics             Show traffic statistics information
  uaps                           Show UAPS configure and status
  unicast-service-profile        Show unicast service profile
  updatecpld                     Show cpld update status
  user-authen-type               Show user authentication config
  username                       Show cli user config
  users                          Show information about terminal lines
  vct                            Show VCT interface
  vdsl2                          Show vdsl2 information
  version-running                Show version running on the card
  version-saved                  Show version stored in mp file system
  virtual-mac                    Show virtual mac information
  vlan                           VLAN status
  vlan-connect                   Show vlan-connect rules
  vlan-reserve                   Show reserve VLAN status
  vlan-scb-action                Show VLAN scb action information
  vlan-smart-qinq                Show VLAN smart qinq information
  vlan-translate                 Show VLAN translate information
  vlan-transparent               Show VLAN transparent information
  voip-media                     Show the priority of voip media
  vpls                           Show vpls
  vport-create-error             Show vport-create-error
  vrg                            Show VRG information
  xdsl                           Show vdsl2 information
```

---

## 3. Comandos `show gpon` (GPON)

```
show gpon global              Show GPON global information
show gpon loid                Show GPON card loid and loid-password
show gpon loid-mode           Show GPON LOID authentication mode
show gpon mop                 Show GPON multicast operation profile
show gpon olt                 Show GPON OLT information
show gpon onu                 Show GPON ONU information
show gpon onu baseinfo        Show GPON ONU basic information
show gpon onu by              Show GPON ONU search result
show gpon onu config-fail     Show GPON ONU config failed information
show gpon onu detail-info     Show GPON ONU detail information
show gpon onu distance        Show GPON ONU distance information
show gpon onu gemport         Show GPON ONU GEM port information
show gpon onu next-available  Show GPON ONU next available resource index
show gpon onu profile         Show GPON ONU profile information
show gpon onu state           Show GPON ONU state information
show gpon onu state gpon-olt_1/2   → solo slot 2
show gpon onu state gpon-olt_1/3   → solo slot 3
show gpon onu state gpon-olt_1/4   → solo slot 4
show gpon onu tcont           Show GPON ONU T-CONT information
show gpon onu uncfg           Show GPON unconfigured ONU information
show gpon onu vport           Show GPON ONU vport information
show gpon password-encrypt    Show GPON password encryption state
show gpon profile             Show GPON ONU profile configuration
show gpon register-check      Show GPON ONU register-check information
show gpon remote-onu          Show GPON remote ONU information
show gpon slot                Show GPON OLT information
show gpon sn                  Show GPON card sn and password information
```

---

## 4. Comandos de configuración (`configure terminal`)

```
configure terminal (desde ZXAN#)
  aaa                Authentication, Authorization and Accounting
  auto-update        Configure auto-update
  bfd                Configure bfd
  bgp                Border Gateway Protocol (BGP)
  bonjour            Configure Bonjour
  bridge             Configure bridge
  cfm                Connectivity fault management
  class-map          Configure class-map
  clock              Configure clock
  control-panel      Configure panel
  cpe                Configure cpe
  customer          Customer configuration
  debug              Configure debug trace
  dhcp               Configure dhcp
  dhcp-relay         Configure dhcp-relay
  dhcpv6             Configure dhcpv6
  dialer             Configure dialer
  dns                Configure dns
  dot1x              Configure dot1x
  dwn                Configure Download
  epm                Configure epm config
  erps               Configure erps ring
  eth-oam            Configure ethernet-oam
  ethernet           Configure ethernet
  exit               Exit from configure mode
  fdb                Configure FDB
  file               Config File Server
  flow               Config Flow
  ftp                Configure ftp
  gvrp               Configure GVRP
  host               Configure host
  igmp               Configure igmpsnooping
  igmp-profile       Configure IGMP profile
  igmpproxy          Configure igmpproxy
  interface          Select an interface to configure
  ip                 Configure IP
  ip-mirror          Configure ip-mirror
  ipoa               Configure ipoa
  iptv               Configure iptv
  ipv6               Configure IPv6
  isis               IS-IS routing
  lacp               Configure LACP
  lldp               Configure LLDP
  load-balance       Configure load-balance
  logging            Configure syslog
  loopback-detect    Configure Loopback detection
  mac                Configure mac
  mcast              Configure multicast
  monitor            Configure monitor
  mpls               Configure mpls
  mstp               Configure mstp
  no                 Negate a command or set its defaults
  ntp                Configure NTP
  ospf               Open Shortest Path First (OSPF)
  ping-check         Ping check
  policy-map         Configure policy-map
  pon                Configure pon
  port-channel       Config Port-channel
  ppp                Configure ppp
  ptp                Configure ptp
  qos                Configure qos
  radius-server      Configure radius-server
  route-map          Configure route-map
  router             Configure router
  security           Configure security
  service-port       Configure service-port
  snmp               Configure SNMP
  spanning-tree      Configure spanning-tree
  ssh                Configure SSH
  storm-control      Configure storm-control
  summertime         Configure summertime
  system             Configure system
  tacacs-server      Configure tacacs-server
  template           Configure template
  tftp               Configure tftp
  track              Configure track
  traffic            Configure traffic
  trunk              Configure trunk
  update-boot        Configure update boot
  version            Configure version
  vlan               Configure vlan
  voice              Configure voice
  vrrp               Configure vrrp
  web                Configure web server
  xconnect           Configure Xconnect
  end                Exit to privilege mode
```

---

## 5. Comandos `debug`

```
debug aaa              AAA debugging
debug all              Debug all
debug arp              ARP debugging
debug auth             Authentication debugging
debug bfd              BFD debugging
debug bgp              BGP debugging
debug bridge           Bridge debugging
debug cfm              CFM debugging
debug dhcp             DHCP debugging
debug dhcp-relay       DHCP relay debugging
debug dot1x            DOT1X debugging
debug epm              EPM debugging
debug erps             ERPS debugging
debug ethernet-oam     Ethernet OAM debugging
debug event            Event debugging
debug ftp              FTP debugging
debug igmp             IGMP debugging
debug igmpproxy        IGMP proxy debugging
debug ip               IP debugging
debug ipoa             IPOA debugging
debug iptv             IPTV debugging
debug ipv6             IPv6 debugging
debug isis             IS-IS debugging
debug lacp             LACP debugging
debug lldp             LLDP debugging
debug ltv              LTV debugging
debug mac              MAC debugging
debug mcast            Multicast debugging
debug mld              MLD debugging
debug mpls             MPLS debugging
debug ntp              NTP debugging
debug ospf             OSPF debugging
debug ping-check       Ping-check debugging
debug ppp              PPP debugging
debug pppoe            PPPoE debugging
debug qos              QoS debugging
debug ripng            RIPng debugging
debug snmp             SNMP debugging
debug ssh              SSH debugging
debug storm            STORM debugging
debug stp              STP debugging
debug tacacs           TACACS debugging
debug track            Track debugging
debug trunk            Trunk debugging
debug vlan             VLAN debugging
debug voice            VOICE debugging
debug vrrp             VRRP debugging
debug web              WEB debugging
debug xconnect         Xconnect debugging
```

---

## 6. Comandos para `show gpon onu baseinfo` por filtro

```
show gpon onu baseinfo                     → todas las ONUs
show gpon onu baseinfo gpon-onu_1/2/1:1    → ONU específica
show gpon onu baseinfo sn <SERIAL>         → buscar por SN
show gpon onu baseinfo board 2             → por slot
show gpon onu baseinfo port 1              → por puerto (slot+port)
```

---

## 7. Comandos `show interface`

```
show interface gei_1/10/1     → uplink 1G
show interface xgei_1/19/1    → uplink 10G
show interface xgei_1/20/1    → uplink 10G (clientes)
show interface xgei_1/20/2    → uplink 10G (anillo)
show interface gpon-olt_1/2   → puerto GPON slot 2
show interface gpon-olt_1/3   → puerto GPON slot 3
show interface gpon-olt_1/4   → puerto GPON slot 4
```

---

## 8. Tarjetas Instaladas (de `show running-config`)

```
Slot 2:  GTGH   (GPON 16 puertos)
Slot 3:  GTGH   (GPON 16 puertos)
Slot 4:  GTGH   (GPON 16 puertos)
Slot 19: HUVQ   (Uplink)
Slot 20: HUVQ   (Uplink)
```

---

## 9. Configuración Actual de la OLT

- **Nombre**: JOEL WIFI
- **Modelo**: ZTE C300
- **IP**: 192.168.20.80
- **Firmware**: V2.1.0
- **Uptime**: 105 días (al 10/06/2026)
- **ONUs**: 640 totales, 627 online, 13 offline
- **Puertos uplink activos**:
  - `xgei_1/20/1` — Clientes (10G-FullD)
  - `xgei_1/20/2` — Red Anillo (10G-FullD)

---

## 10. Métodos rápidos desde `olt-admin.js`

El módulo `backend/olt-admin.js` exporta funciones async que usan SOCKS4+Telnet:

```javascript
const { getCards, getSystemInfo, getPonPorts, getUplinkPorts, queryOLT } = require('./backend/olt-admin');

const cards = await getCards();           // show card
const sysInfo = await getSystemInfo();    // show system-group + show temperature
const ports = await getPonPorts();        // show gpon onu state (parse per-port)
const uplink = await getUplinkPorts();    // show interface (datos estáticos)

// Para comandos arbitrarios:
const output = await queryOLT(['terminal length 0', '<comando>'], 45000);
```

**Nota**: cada query toma ~4-8s por el SOCKS proxy + login Telnet + delays entre comandos.

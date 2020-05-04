#!/bin/bash

# Simulate poor network conditions (high latency, packet loss, bandwidth limits) locally for testing
# NOTE: Network Link Conditioner (the built-in tool for OSX) does not seem to support UDP, so use dummynet and PF instead.
# See https://spin.atomicobject.com/2016/01/05/simulating-poor-network-connectivity-mac-osx/

PACKET_LOSS=0.02 # Percentage of packets that will be dropped (0.01 means 1% will be dropped).
PACKET_DELAY=50 # In milliseconds. Artificially delay the one-way-time of a packet by this amount.

helpFunction()
{
   echo ""
   echo "Usage: $0 <start | stop> [-l packetLoss] [-d delay]"
   echo -e "\tstart: Enable network conditioning"
   echo -e "\tstop: Clear all settings and return network to normal operation"
   echo -e "\t[-l]: Override default packet loss percentage [0.00 to 1.00]"
   echo -e "\t[-d]: Override default delay, in ms"
   exit 1 # Exit script after printing help
}

start() 
{
    dnctl pipe 1 config delay $PACKET_DELAY plr $PACKET_LOSS
    echo "dummynet in proto udp from any to any pipe 1" | pfctl -f -
    pfctl -e
}

stop() 
{
    pfctl -f /etc/pf.conf
    dnctl -q flush
    pfctl -d
}

while getopts ":l:d:" opt; do
    case ${opt} in 
        l ) 
            PACKET_LOSS=$OPTARG
            ;;
        d ) 
            PACKET_DELAY=$OPTARG
            ;;
        \? ) helpFunction
            ;;
    esac
done
shift $((OPTIND -1))

subcommand=$1
shift # Remove `NetworkShape` from the argument list

case "$subcommand" in 
    start)
        start
        ;;
    stop)
        stop
        ;;
    *)
        helpFunction
        ;;
esac
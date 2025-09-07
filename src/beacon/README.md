### Beacon Usage Flow:
- Beacon loads → sends beacon:ready-for-channel (repeats every 1s)
- SDK receives signal → establishes MessageChannel
- Beacon gets port → sets up listeners
- Beacon confirms → sends beacon:channel-established
- SDK ready → both sides can communicate via MessagePort

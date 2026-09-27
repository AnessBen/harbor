package com.lagradost.cloudstream3.extractors

class LuluVdo : LuluStream() {
    override val name = "LuluStream"
    override val mainUrl = "https://luluvdo.com"
}

class ByseMfw09 : Byse("Byse", "https://mfw09.org")

class MiiixDrop : MixDrop() {
    override val name = "MixDrop"
    override val mainUrl = "https://miiixdrop.net"
}

class VidmolyNet : Vidmoly() {
    override val name = "Vidmoly"
    override val mainUrl = "https://vidmoly.net"
}

class VVide0 : DoodStream() {
    override val name = "DoodStream"
    override val mainUrl = "https://vvide0.com"
}

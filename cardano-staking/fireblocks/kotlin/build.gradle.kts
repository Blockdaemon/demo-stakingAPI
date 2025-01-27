plugins {
    kotlin("jvm") version "2.0.0"
}

group = "example"

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.fireblocks.sdk:fireblocks-sdk:5.0.0") // Fireblocks SDK
    implementation("com.upokecenter:cbor:4.5.2") // CBOR for transaction encoding
    implementation("org.bouncycastle:bcprov-jdk15on:1.70") // Blake2b hash function
    implementation("com.squareup.okhttp3:okhttp:4.11.0")
    implementation("com.beust:klaxon:5.5")
    implementation("commons-codec:commons-codec:1.15")
    implementation("com.bloxbean.cardano:cardano-client-lib:0.5.1")

    testImplementation(kotlin("test"))
}


tasks.test {
    useJUnitPlatform()
}

tasks.withType<JavaExec> {
    jvmArgs("--add-opens", "java.base/sun.security.ssl=ALL-UNNAMED")
}


kotlin { jvmToolchain(21) }
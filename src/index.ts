// For decompressing
import { Base64 } from 'js-base64';
// For TCP socket
import { connect } from 'cloudflare:sockets';

export default {
  async fetch(req): Promise<Response> {
    // Check pre-shared key header
    const PRESHARED_AUTH_HEADER_KEY = 'X-Logpush-Auth';
    const PRESHARED_AUTH_HEADER_VALUE = 'mypresharedkey';
    const psk = req.headers.get(PRESHARED_AUTH_HEADER_KEY);
    const contentEncoding = req.headers.get('content-encoding')
    if (psk !== PRESHARED_AUTH_HEADER_VALUE) {
      return new Response('Sorry, you have submitted an invalid key.', {
        status: 403,
      });
    }

    // Decompress gzipped logpush body to json
    const buf = await req.arrayBuffer();
    const enc = new TextDecoder("utf-8");
    const blob = new Blob([buf])
    const ds = new DecompressionStream('gzip');
    const decompressedStream = blob.stream().pipeThrough(ds);
    const buffer2 = await new Response(decompressedStream).arrayBuffer();
    const decompressed = new Uint8Array(buffer2)
    const ndjson = enc.decode(decompressed)
    console.log(`Received ndjson === ${ndjson}`)

    // Initial pre-flight Logpush Request to confirm the integration check
    if (ndjson === '{"content":"test"}') {
      console.log('pre-flight check phase')
      console.log(ndjson)
      return new Response('Initial pre-flight Logpush Request has been confirmed', {
        status: 200,
      })
    }

    // parse ndjson to JSON object
    var json = '[' + ndjson.trim().replace(/\n/g, ',') + ']';
    console.log(`Logpushed json = ${json}`);
    const jsonobj = JSON.parse(json);

    try {
      // Define Your Syslog Endpoint
      const syslogEndpoint = { hostname: "x.x.x.x", port: 514 };
      const socket = connect(syslogEndpoint/* , { secureTransport: "on" } */);
      let writer = socket.writable.getWriter()

      // Write Syslog RFC 3164 Format message
      //"<34>Oct 11 22:14:15 gateway_http AccountID=\"xxx\" Action=\"bypass\" Datetime=\"1724782330\" DestinationIP=\"x.x.x.x\" DeviceName=\"xxx\" Email=\"xxx@example.com\" HTTPHost=\"www.google.co.jp\" HTTPMethod=\"UNKNOWN\" HTTPStatusCode=\"0\" \n");
      jsonobj.map(jsonelem => {
        const jsonfmt = JSON.stringify(jsonelem, null, 2);
        //console.log(`jsonfmt = ${jsonfmt}`);
        let jstNow = new Date(Date.now() + ((new Date().getTimezoneOffset() + (9 * 60)) * 60 * 1000))//.toLocaleString({ timeZone: 'Asia/Tokyo' });
        let MMMddHHmmss = jstNow.toString().slice(4, 7) + ' ' + jstNow.getDate() + ' ' + jstNow.toTimeString().slice(0, 8)
        console.log(MMMddHHmmss)
        let message = '<34>' + MMMddHHmmss + ' gateway_http ' + Object.keys(jsonelem).map(function (key) { return key + '=' + JSON.stringify(jsonelem[key]) }).join(' ') + ' \n'
        console.log(`Syslog message = ${message}`)
        writer.write(new TextEncoder().encode(message));
      })

      await writer.close();

      // The syslog server should now return a response to us and close the connection.
      // So start reading from the socket.	  
      const decoder = new TextDecoder();

      let syslogResponse = "";
      for await (const chunk of socket.readable) {
        syslogResponse += decoder.decode(chunk, { stream: true });
      }
      syslogResponse += decoder.decode();

      console.log("Read ", syslogResponse.length, " from Syslog server");

      return new Response(syslogResponse, { headers: { "Content-Type": "text/plain" } });
    } catch (error) {
      return new Response("Socket connection failed: " + error, { status: 500 });
    }
  }
} satisfies ExportedHandler;
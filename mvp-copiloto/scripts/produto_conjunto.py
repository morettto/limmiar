import json
import sqlite3
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]

P = [
("04aa4935", ["277dd37f", "5e3086dc"], ["ninguém lá em casa acredita que minha irmã tá doente, acham que ela finge pra ser paparicada", "minha própria mãe diz que a depressão do meu irmão é frescura, que ele faz drama"], "meu irmão com esquizofrenia começou a ouvir vozes de novo esta semana"),
("04aa4935", ["70495e3c", "ba5ab58e", "6d51b82b", "ca52cdc1"], ["desde que meu filho adoeceu eu fico me perguntando onde foi que eu errei na criação dele", "eu me culpo pela doença da minha filha, acho que foi a separação que causou isso"], "meu filho largou o remédio e eu não sei como convencer ele a tomar"),
("04aa4935", ["2913005f", "841349fe"], ["cuidar do meu pai doente tomou minha vida, não tenho mais lazer, dinheiro nem descanso", "desde que minha mãe adoeceu da cabeça eu parei de sair, gasto tudo com ela e vivo cansada"], "meu pai com Alzheimer não reconhece mais ninguém da família"),
("04aa4935", ["4ff71def"], ["depois da crise do meu filho eu comecei a faltar no serviço e chorava o dia inteiro", "eu choro tanto por causa da doença do meu filho que vivo com o olho vermelho"], "no trabalho meu chefe me humilha na frente de todo mundo"),
("15ede6da", ["0f653424", "6283126e", "c0e2a165", "b5b9a285", "c72a0773", "57a22d03"], ["como muito de uma vez, sem conseguir parar, e depois provoco o vômito", "fico dias sem comer pra emagrecer e depois ataco a geladeira sem controle"], "eu tenho pavor de engasgar, por isso só como comida pastosa"),
("15ede6da", ["4c117301", "c72a0773", "57a22d03"], ["quando fico com raiva eu me corto nos braços e depois até dou risada contando", "sou muito impulsiva, quando algo me frustra eu me machuco na hora"], "eu roo as unhas quando fico nervosa em reunião"),
("15ede6da", ["8062cb5c", "071e352c", "39ab988b"], ["acho que você não se importa comigo de verdade, só me atende porque é pago", "perdi a confiança em você e não vou te contar mais nada da minha vida"], "você pode trocar o horário da sessão de quinta para sexta?"),
("1686d198", ["9c10c5e5", "87b3ccdb", "6794c259", "02aa325a", "752f36cc", "30f24181"], ["tenho pesadelos com o assalto toda noite", "desde o acidente eu evito passar de carro naquela estrada"], "depois do assalto o seguro não quis pagar o meu celular"),
("1686d198", ["8bce76bc", "8ed80fe8", "f9917817"], ["depois do estupro eu passei a achar que a culpa foi minha e que o mundo é perigoso", "desde o assalto eu acho que ninguém é confiável e que eu deveria ter reagido diferente"], "tenho medo de avião desde criança, nunca viajei"),
("1686d198", ["f9917817", "8bce76bc", "ef3354fc"], ["ele me batia e mesmo assim eu sinto culpa, como se eu tivesse provocado", "me sinto culpada pelo que meu ex-marido fez comigo, acho que mereci"], "meu marido e eu brigamos por causa de dinheiro toda semana"),
("170f2095", ["c8606664", "f29b655c", "88bbd92f", "2d0b2234"], ["en:I cut myself on purpose, but I don't want to die", "eu me machuco de propósito, me queimo com isqueiro, mas não quero morrer"], "en:I fell off my bike and scraped my knee last week"),
("170f2095", ["e0ed8a2c", "c4b25e4f", "2d0b2234", "cecbaf0e"], ["comecei a me cortar com treze anos e agora às vezes penso em me matar", "en:my daughter is fourteen and she started hurting herself this year"], "minha filha de catorze anos está muito rebelde e responde a tudo"),
("1af1f76f", ["0d531fb3", "1a02380f", "696c5142"], ["sou professora e o excesso de trabalho e a falta de reconhecimento da escola estão me esgotando", "dou aula há vinte anos e a sobrecarga, a papelada e a diretoria me deixaram exausto"], "sou professora e estou pensando em fazer mestrado ano que vem"),
("1af1f76f", ["eb40311c"], ["sinto que fracassei como professora, meus resultados não valem nada", "no trabalho sinto que não consigo realizar mais nada, parece que fracassei como profissional"], "tirei nota baixa na prova de direção e fiquei chateado"),
("1af1f76f", ["6ef0c5ea", "d872780f", "322a828d"], ["estou exausta, não sinto mais nada pelos pacientes", "es:estoy agotada del trabajo y ya trato a mis alumnos con frialdad, como si fueran objetos"], "es:quiero cambiar de escuela porque queda muy lejos de mi casa"),
("2c4aec27", ["c474b2de", "035ab3a7", "48323d98"], ["sou enfermeira na UTI e desde a pandemia vivo esgotada, com insônia e sensação de impotência", "trabalho no hospital e tenho medo de levar o vírus pra casa e contaminar minha família"], "sou enfermeira e quero mudar de setor por causa do salário"),
("2c4aec27", ["1f8ef8ea", "eb75f66a", "52436f3c"], ["desde a pandemia não tenho coragem de sair de casa e desinfeto tudo o tempo todo", "es:tengo pánico de salir a la calle, limpio todo con alcohol una y otra vez"], "vou tomar a vacina da gripe semana que vem"),
("2c4aec27", ["e5d07cfe", "4d3656b6"], ["quando recebi o diagnóstico de covid fiquei em negação, com raiva e medo de morrer", "fiquei isolado com covid e me senti tão sozinho que pensei em largar o tratamento"], "tive covid ano passado e fiquei sem olfato por um mês"),
("33aa9fa0", ["5f581fa0"], ["desde que parei de beber há um mês minha tristeza melhorou muito", "quando eu bebo fico deprimido, mas nas semanas em que fico sem álcool o humor volta"], "parei de fumar há um mês e estou mais irritado"),
("33aa9fa0", ["edd14123", "654ef276", "6b5aceb7"], ["perdi o prazer em tudo, não durmo direito e não tenho fome há semanas", "nada mais me dá prazer, nem as coisas que eu amava, e fico acordado de madrugada"], "estou dormindo mal porque o vizinho faz barulho até tarde"),
("33aa9fa0", ["6b5aceb7", "654ef276"], ["faz uns três anos que vivo meio pra baixo, não é uma tristeza forte, mas nunca passa", "há anos me sinto desanimado quase todo dia, com pouca energia e autoestima baixa"], "fiquei triste no fim de semana porque meu time perdeu"),
("33aa9fa0", ["3377375f", "dce18280"], ["comecei a ir no AA e além de beber menos minha depressão diminuiu", "as reuniões dos Alcoólicos Anônimos estão me ajudando com a tristeza também"], "comecei a ir na academia e perdi quatro quilos"),
("3fee4cc4", ["b192358b", "778d9b22"], ["às vezes eu queria estar morto e já pensei em como faria isso", "en:sometimes I wish I were dead and I have thought about how I would kill myself"], "fiz um seguro de vida porque tenho dois filhos pequenos"),
("3fee4cc4", ["47702e29", "46edb03b", "88bbd92f"], ["eu fico pensando em me cortar o tempo todo, mesmo quando não faço", "tenho vontade de me machucar várias vezes por dia, mas tenho segurado"], "tenho pensado muito em trocar de emprego"),
("3fee4cc4", ["bae2e8c1"], ["de tanto me cortar, a dor já não me assusta, e isso me faz pensar que eu conseguiria me matar", "já me machuquei tantas vezes que perdi o medo da dor e da morte"], "faço tatuagem e já nem sinto mais a dor da agulha"),
("6556ed0d", ["65cf8972", "ce3dd089"], ["estou grávida e bebo escondido porque todo mundo ia me julgar", "eu bebo todo dia e escondo as garrafas"], "estou grávida e tenho enjoo toda manhã"),
("6556ed0d", ["f15f2cdf", "19bdff42"], ["meu marido reclama quando eu bebo e às vezes acordo sem lembrar o que fiz na noite anterior", "depois de beber, no outro dia não lembro de parte da noite"], "esqueço onde deixo as chaves quase todo dia"),
("6556ed0d", ["9b9226b1", "19bdff42"], ["hoje preciso de muito mais cerveja do que antes pra sentir alguma coisa", "antes duas latas me deixavam alta, agora preciso de umas seis"], "preciso tomar mais café do que antes pra acordar"),
("6c74229a", ["618d26ab", "3a67ff8e"], ["depois que minha esposa morreu, esqueço tudo e não consigo me concentrar", "desde que fiquei viúva minha memória piorou, perco o fio da conversa"], "minha mãe de oitenta anos está esquecendo o nome dos netos"),
("6c74229a", ["3a67ff8e", "fb82b499", "c8465183", "ca82477d"], ["desde que perdi meu marido estou deprimida, e quanto mais sinto falta dele, pior fico", "fiquei viúvo em março e desde então vivo triste, sem vontade de nada"], "meu marido viaja muito a trabalho e eu fico sozinha em casa"),
("6db7bb10", ["96e6d737"], ["evito shopping e ônibus lotado porque tenho medo de passar mal e ficar presa lá", "es:tengo miedo de los lugares llenos, siento que me voy a quedar atrapada sin salida"], "não gosto de shopping porque acho tudo caro"),
("6db7bb10", ["849f2d5e"], ["do nada me vem um medo enorme e a sensação de que vou morrer ali mesmo", "es:de repente me da un ataque de pánico y siento que me voy a morir"], "levei um susto enorme quando o carro da frente freou do nada"),
("952b4ae6", ["092922d5", "ccd9b37e", "c3d7de29"], ["desde que nosso bebê morreu, meu casamento está desmoronando", "perder meu filho acabou comigo e com meu marido, estamos falando em separação"], "meu filho saiu de casa pra estudar fora e sinto falta dele"),
("952b4ae6", ["4ce52f9f"], ["no fundo senti alívio quando minha filha morreu, ela sofria tanto com a doença", "sei que parece errado, mas a morte do meu filho foi um descanso pra ele depois de tanto sofrimento"], "senti alívio quando terminei o namoro"),
("952b4ae6", ["cdaf76d7", "fd9587ca"], ["minha fé é o que me mantém de pé desde que meu filho morreu", "desde a morte da minha filha só a igreja me dá algum consolo"], "comecei a ir na igreja porque me mudei de bairro"),
("9592f708", ["2d0b2234", "59200904", "c72a0773"], ["quando a dor por dentro fica insuportável eu me corto e aí alivia", "me corto pra aliviar a angústia, é o único jeito que eu acho de me acalmar"], "eu me belisco pra ficar acordada na aula"),
("9592f708", ["321eef33", "59200904"], ["faz seis meses que eu me machuco, eu mesma cuido dos machucados e não quero morrer", "eu escondo os cortes e faço os curativos sozinha pra ninguém descobrir"], "machuquei o pé jogando bola e eu mesmo fiz o curativo"),
("9592f708", ["6bb61255"], ["da última vez que contei que me cortava, minha mãe gritou comigo, então não conto mais pra ninguém", "a professora fez escândalo quando viu meus cortes e agora eu não peço ajuda"], "minha mãe gritou comigo porque tirei nota baixa"),
("9ad1372c", ["02aa325a", "752f36cc", "99c4384e"], ["quando sinto cheiro de gasolina parece que estou de novo dentro do carro batido", "qualquer barulho de moto me leva de volta pro dia do assalto, como se estivesse acontecendo agora"], "adoro cheiro de gasolina, me lembra as viagens de infância"),
("9ad1372c", ["6384318c", "ff55d528"], ["quando falo do trauma o que mais aparece nem é medo, é vergonha e raiva", "lembrar do abuso me dá mais vergonha e culpa do que medo"], "tenho vergonha de falar em público"),
("9ad1372c", ["cf188102", "99c4384e"], ["sinto que o acidente me transformou pra sempre, larguei tudo que eu fazia antes", "depois do trauma parei de ver amigos e de fazer as coisas que gostava, sinto que virei outra pessoa"], "mudei muito depois que virei mãe, minhas prioridades são outras"),
("9b8e2a1f", ["8196b1f6"], ["depois da mastectomia não consigo me olhar no espelho, me sinto menos mulher", "desde a retirada da mama fico ansiosa e desanimada, não me reconheço mais"], "fiz uma plástica no nariz e não gostei do resultado"),
("9b8e2a1f", ["bd6d39e7", "6f95ad52"], ["minha cirurgia do câncer é semana que vem e a ansiedade não me deixa em paz", "desde o diagnóstico de câncer de mama vivo ansiosa, principalmente com a cirurgia"], "vou fazer uma cirurgia de joelho e estou tranquila"),
("a9369a5e", ["243d5d4f"], ["não tenho coragem de contar pra ninguém que sou soropositivo", "vivo com HIV há cinco anos e nem minha família sabe, tenho pavor que descubram"], "fiz o exame de HIV e deu negativo, fiquei aliviado"),
("a9369a5e", ["0a54b20c"], ["no posto a enfermeira me tratou diferente quando viu que eu tenho HIV", "tenho medo que o pessoal do postinho espalhe meu diagnóstico de HIV"], "o médico do posto atrasou duas horas pra me atender"),
("a9369a5e", ["c09a0418", "29a2b5f1", "7747d791"], ["quando descobri o HIV achei que as pessoas iam me ver como promíscuo e que eu ia morrer logo", "meu diagnóstico de HIV virou uma sentença moral, todo mundo me julga"], "tenho diabetes e preciso tomar insulina todo dia"),
("aad13b9f", ["ab698b50"], ["desde que meu marido morreu eu não sei pagar as contas nem resolver nada da casa, vivo ansiosa", "era ele que cuidava do banco e dos consertos, agora sozinha fico desesperada"], "meu marido nunca me ajuda com as tarefas de casa"),
("aad13b9f", ["746ef3aa", "501326e8", "2725e897"], ["tem dias que só choro pela minha esposa e tem dias que consigo cuidar da vida e até me distrair", "fico indo e voltando, uma hora mergulho na saudade da minha mãe, outra hora tento seguir em frente"], "tem dias que acordo animado e outros não, depende do tempo"),
("aad13b9f", ["0bbca487"], ["a gente brigava muito e agora que ele morreu o meu luto é uma confusão de raiva e saudade", "fomos casados cinquenta anos, ele era tudo pra mim, não sei viver sem ele"], "meu casamento anda morno, a gente quase não conversa"),
("afec52a2", ["e7f3a5ab", "4de5fe9a", "e2ca9867"], ["desde o enterro da minha mãe não sinto nada, pareço um robô fazendo as coisas no automático", "es:desde que murió mi hermano estoy como congelada por dentro, no siento nada"], "sinto frio o tempo todo, mesmo no verão"),
("afec52a2", ["64a4dd2b"], ["no aniversário da morte do meu pai tudo volta com força, parece que foi ontem", "chega o natal e a falta da minha filha me paralisa de novo"], "no meu aniversário sempre fico meio reflexivo sobre a idade"),
("afec52a2", ["03725cdf", "419be5f9"], ["desde que minha avó morreu sinto raiva, culpa e choro o tempo todo", "a morte do meu irmão me deixou uma mistura de impotência, culpa e tristeza"], "choro fácil vendo filme romântico"),
("afec52a2", ["739d119c"], ["hoje consigo lembrar do meu marido que faleceu com carinho, sem aquela dor que me derrubava", "já consigo falar da minha mãe falecida sorrindo, a saudade ficou mais leve"], "finalmente terminei a reforma da cozinha"),
("afec52a2", ["7bdd36bc"], ["desde que o médico disse que meu câncer é terminal sinto muita raiva e medo de morrer", "sei que tenho pouco tempo de vida e isso me enche de fúria e impotência"], "tenho medo de ficar doente quando envelhecer"),
("c9998f6c", ["d35f7493"], ["minha ansiedade piorou muito com a pressão no trabalho e as dívidas", "vivo ansioso por causa do emprego e do dinheiro que não dá"], "quero pedir aumento mas não sei como abordar meu chefe"),
("c9998f6c", ["52436f3c", "1f8ef8ea", "4d3656b6"], ["ficar isolada em casa na pandemia me deixou ansiosa, deprimida e com medo", "o isolamento da quarentena me trouxe uma ansiedade que eu nunca tinha tido"], "moro sozinho e gosto muito do silêncio"),
("cb6404c1", ["d01c2da7", "b23ff332"], ["com a depressão minha autoestima foi lá pra baixo, sinto que não valho nada", "a ansiedade acabou com minha autoestima, me acho inferior a todo mundo"], "quero cortar o cabelo pra mudar o visual"),
("cb6404c1", ["b23ff332", "d01c2da7"], ["es:desde que tengo depresión me siento menos que los demás, mi autoestima está por el suelo", "desde que comecei o tratamento pra ansiedade percebo que minha autoestima é bem menor que a dos meus amigos"], "es:mi hermana siempre fue la más guapa de la familia"),
("cbab19fa", ["6fa6211c", "eb1800aa"], ["depois do divórcio só penso em me vingar do meu ex, a culpa foi toda dele", "es:tengo un rencor enorme hacia mi exmujer, quiero que sufra lo que yo sufrí"], "meu ex e eu dividimos a guarda e está tudo tranquilo"),
("cbab19fa", ["695d4508"], ["o divórcio me deixou humilhada, tenho vergonha de encarar as pessoas", "me sinto um fracassado e humilhado desde que minha mulher pediu a separação"], "o advogado do divórcio está cobrando caro demais"),
("cbab19fa", ["90f792b2", "64a3baa1", "e0e50e52"], ["não consigo perdoar meu ex e isso atrapalha tudo na criação dos nossos filhos", "a raiva que tenho do pai das crianças está afetando como a gente cuida delas"], "meus filhos brigam muito entre si"),
("cbab19fa", ["ef3354fc"], ["sempre perdoo ele depois que me bate e acabo voltando pra casa", "já perdoei meu marido tantas vezes pelas agressões que voltei três vezes"], "meu marido esqueceu nosso aniversário de casamento e eu perdoei"),
("cdeda500", ["30f24181", "3635e3d4", "313d628b"], ["desde o acidente de moto tenho dor nas costas e fico em pânico quando lembro da batida", "a dor da fratura me lembra o acidente toda hora e aí vem a ansiedade"], "tenho dor nas costas porque trabalho o dia todo sentado"),
("cdeda500", ["f0a697b9"], ["quando a dor aperta meu coração dispara, eu fico tenso e ofegante", "a dor e a ansiedade vêm juntas: coração acelerado, músculos travados, falta de ar"], "meu coração acelera quando corro na esteira"),
("cdeda500", ["467074a1"], ["tenho medo de ficar ansioso porque acho que o coração acelerado vai me matar", "quando sinto a ansiedade chegando entro em pânico achando que vou ter um infarto"], "meu pai teve infarto e agora faço check-up todo ano"),
("d64d32f3", ["4e7daf06", "2d0b2234"], ["me corto porque alivia a tensão, e também porque assim as pessoas prestam atenção em mim", "es:me lastimo para sentir algo, y a veces para que mi familia me haga caso"], "faço piercing porque acho bonito"),
("d64d32f3", ["f29b655c", "c8606664", "88bbd92f"], ["es:me hago daño en el cuerpo a propósito, pero no quiero matarme", "eu me arranho até sangrar de propósito, mas nunca quis me matar"], "es:me corté el dedo cocinando y me asusté"),
("d7d427dc", ["134794fd", "0ce730ae"], ["é mais fácil falar dos meus problemas com um aplicativo do que com uma pessoa, morro de vergonha", "en:I find it easier to tell a chatbot about my anxiety than to tell a real person"], "uso aplicativo pra contar os passos e as calorias"),
("d7d427dc", ["8bc2f269", "134794fd"], ["en:talking to a virtual counselor helps me open up about my panic, people scare me", "tenho fobia social e só consigo me abrir com o assistente virtual da terapia"], "en:I use a virtual assistant to schedule my meetings"),
("e080a45e", ["0b65c237", "724ca5de"], ["ando nervosa, tensa e preocupada o tempo todo, e me sinto triste sem motivo", "na menopausa vivo nervosa e tristonha, choro por qualquer coisa"], "estou na menopausa e minha ginecologista pediu exames de rotina"),
("e080a45e", ["84ec9884", "7f962ce7", "22b4786d"], ["desde que entrei no climatério minhas emoções estão uma montanha-russa e minha vida piorou", "com a menopausa fiquei instável, irritada, e perdi a qualidade de vida"], "minha filha adolescente está com a menstruação irregular"),
("e2a73899", ["2a4dc7d3", "4f16e3a5", "d3c721bc", "32704400"], ["vivo sonhando que tenho que refazer a prova do vestibular e acordo angustiado", "mesmo formada, sonho que fui reprovada na escola e acordo com o coração disparado"], "tenho prova da faculdade amanhã e não estudei nada"),
("e2a73899", ["147fca71", "584eb65f"], ["sonho sempre que estou pelada no meio da rua e ninguém repara", "tenho um sonho repetido de estar sem roupa na frente de desconhecidos e morrer de vergonha"], "tenho vergonha de trocar de roupa no vestiário da academia"),
("e2a73899", ["fa09615f", "149a2940", "8ca36623"], ["sonhei que minha mãe morria e acordei chorando, mas ela está bem", "tenho sonhado com a morte do meu irmão e fico com culpa, será que no fundo desejo isso?"], "minha mãe está internada e tenho medo que ela morra"),
("e2a73899", ["f45d5510", "27a4fc80", "25f3fe78", "0a841150"], ["no sonho eu tento correr mas fico grudado no chão, não consigo me mexer", "sonho que o trem vai partir e eu não consigo andar, as pernas não obedecem"], "acordo com as pernas dormentes e formigando"),
("e56a1ead", ["3e051d77", "a1bec003"], ["não sei dizer o que estou sentindo, só sinto um aperto no corpo e pronto", "en:I never know what I feel, I can't put my emotions into words"], "não sei falar inglês e isso atrapalha no trabalho"),
("e56a1ead", ["ee07e208"], ["eu não sei lidar com o que sinto e aí bebo até apagar no fim de semana", "quando não consigo entender o que sinto, bebo muito de uma vez só"], "bebi demais no casamento do meu primo e passei mal"),
("fa975a52", ["bc9844b2", "729d83c7"], ["eu bebo durante o expediente, levo uma garrafinha na mochila", "tomo umas doses no meio do trabalho pra aguentar o dia"], "no trabalho tomo muito café pra aguentar o dia"),
("fa975a52", ["ce3dd089"], ["quando bebo fico agressivo e já quebrei coisas em casa", "a bebida está destruindo minha família, fico violento e depois nem lembro"], "meu vizinho bebe e faz barulho de madrugada"),
("fa975a52", ["729d83c7", "bc9844b2"], ["no meu trabalho todo mundo bebe depois do turno e eu acabo indo junto", "a turma da firma sempre sai pra beber e eu não consigo dizer não"], "no meu trabalho todo mundo fuma e o cheiro me incomoda"),
]

NEUTRAS = [
"bom dia, o trânsito hoje estava horrível", "posso deixar o guarda-chuva aqui?", "semana que vem eu não venho, vou viajar",
"você viu o jogo de ontem?", "o pagamento dessa sessão pode ser no pix?", "hoje eu fiz um bolo de cenoura pra minha filha",
"meu carro está na oficina de novo", "tá fazendo muito calor nessa sala", "comprei um sofá novo pra sala",
"meu cachorro aprendeu a sentar", "esse mês vou mudar de celular", "ontem fui ao mercado e estava cheio",
"hoje acordei cedo pra levar as crianças", "a reunião do condomínio foi longa", "estou pensando em pintar a parede de azul",
"minha sobrinha fez aniversário no sábado", "o ônibus atrasou vinte minutos", "vou almoçar com a minha irmã depois daqui",
"en:the traffic was terrible today", "es:hoy hace mucho frío afuera",
]

MARCAS = {"en:": "en-US", "es:": "es"}


def idioma(texto):
    for marca, lingua in MARCAS.items():
        if texto.startswith(marca):
            return texto[len(marca):], lingua
    return texto, "pt-BR"


def main():
    con = sqlite3.connect(RAIZ / "data" / "acervo.db")
    ids = [r[0] for r in con.execute("select id from trecho")]
    obra_de = dict(con.execute("select id, obra_id from trecho"))

    def completo(prefixo):
        achados = [i for i in ids if i.startswith(prefixo)]
        if len(achados) != 1:
            sys.exit(f"prefixo {prefixo}: {len(achados)} trechos")
        return achados[0]

    saida = {"ajuste": [], "prova": []}
    vistos: dict[str, int] = {}
    for n, (obra, trechos, positivas, negativa) in enumerate(P):
        esperados = [completo(t) for t in trechos]
        assert obra_de[esperados[0]].startswith(obra), (obra, trechos[0])
        ordem = vistos.get(obra, 0)
        vistos[obra] = ordem + 1
        parte = "ajuste" if ordem % 2 == 0 else "prova"
        for k, bruto in enumerate(positivas):
            fala, lingua = idioma(bruto)
            saida[parte].append({"id": f"p{n:02d}-{k}", "parte": parte, "tipo": "positivo", "fala": fala, "idioma": lingua,
                                 "obra": obra_de[esperados[0]], "passagem": esperados[0], "esperados": esperados})
        fala, lingua = idioma(negativa)
        saida[parte].append({"id": f"p{n:02d}-n", "parte": parte, "tipo": "negativo", "fala": fala, "idioma": lingua,
                             "obra": obra_de[esperados[0]], "passagem": esperados[0], "esperados": []})
    for k, bruto in enumerate(NEUTRAS):
        fala, lingua = idioma(bruto)
        parte = "ajuste" if k % 2 == 0 else "prova"
        saida[parte].append({"id": f"n{k:02d}", "parte": parte, "tipo": "neutro", "fala": fala, "idioma": lingua,
                             "obra": None, "passagem": None, "esperados": []})
    pasta = RAIZ / "data" / "avaliacao"
    for parte, linhas in saida.items():
        with open(pasta / f"produto_{parte}.jsonl", "w", encoding="utf-8") as f:
            for linha in linhas:
                f.write(json.dumps(linha, ensure_ascii=False) + "\n")
        tipos = {t: sum(1 for x in linhas if x["tipo"] == t) for t in ("positivo", "negativo", "neutro")}
        print(parte, tipos, "passagens", len({x["passagem"] for x in linhas if x["passagem"]}))


if __name__ == "__main__":
    main()

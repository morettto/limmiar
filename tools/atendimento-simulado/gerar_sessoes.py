"""Synthetic, held-out Portuguese dialogues and measured two-voice SAPI audio."""

import argparse
import json
import re
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.local/simulacao-100/sessoes'
THEMES = {
    'trauma': ('lembranças involuntárias de um assalto', 'passar pela rua onde ocorreu o assalto', 'se eu baixar a guarda, tudo vai acontecer outra vez', 'mudar meu caminho e conferir várias vezes as saídas', 'voltar a circular com uma sensação possível de segurança'),
    'ansiedade_panico': ('episódios de ansiedade intensa e medo das sensações físicas', 'perceber o coração acelerado no transporte público', 'essas sensações significam que vou perder o controle', 'descer antes do destino e pedir confirmação de que estou bem', 'usar o transporte sem organizar o dia inteiro em torno do medo'),
    'depressao': ('desânimo persistente e afastamento de atividades importantes', 'acordar e olhar as tarefas que ficaram para depois', 'não consigo fazer nada direito e vou decepcionar as pessoas', 'ficar na cama e adiar mensagens de pessoas próximas', 'retomar pequenas atividades que tenham significado'),
    'toc': ('dúvidas repetidas e necessidade de conferir', 'fechar a porta de casa antes de sair', 'se eu não conferir de novo, serei responsável por uma tragédia', 'voltar para verificar a fechadura e refazer mentalmente a sequência', 'conviver melhor com a dúvida sem perder horas em verificações'),
    'insonia': ('dificuldade para iniciar o sono e preocupação com a noite', 'olhar o relógio depois de deitar', 'se eu não dormir agora, amanhã será impossível', 'calcular as horas restantes e permanecer na cama tentando forçar o sono', 'construir uma relação menos angustiada com o descanso'),
    'luto': ('saudade intensa e dificuldade para reorganizar a vida após uma perda', 'encontrar uma fotografia da pessoa que morreu', 'seguir em frente talvez signifique esquecer quem eu perdi', 'evitar conversar sobre a perda e deixar decisões cotidianas suspensas', 'preservar o vínculo afetivo enquanto retomo partes da minha vida'),
    'ansiedade_social': ('medo de avaliação em situações sociais', 'precisar dar uma opinião diante de outras pessoas', 'todos vão perceber meu nervosismo e achar que sou incapaz', 'ensaiar tudo mentalmente e falar o mínimo possível', 'participar de conversas sem me vigiar a cada segundo'),
    'dependencia': ('dificuldade para controlar o consumo de álcool', 'chegar em casa depois de um dia de conflito', 'só vou conseguir desligar se eu beber', 'comprar bebida e deixar de lado o que tinha planejado', 'reduzir danos e construir alternativas de cuidado consistentes'),
    'transtornos_alimentares': ('preocupação intensa com alimentação e imagem corporal', 'comer junto de outras pessoas sem ter planejado cada detalhe', 'se eu sair das regras, vou perder todo o controle', 'evitar refeições compartilhadas e compensar com regras cada vez mais rígidas', 'ter uma rotina de alimentação e convivência menos governada pelo medo'),
    'estresse_burnout': ('esgotamento e dificuldade para se desligar das demandas', 'receber uma mensagem de trabalho fora do horário', 'se eu não responder imediatamente, vão pensar que não dou conta', 'continuar trabalhando e abandonar o tempo de descanso', 'estabelecer limites viáveis e recuperar espaço para descanso'),
}
NAMES = ['Ana', 'Beatriz', 'Camila', 'Débora', 'Elisa', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Joana']
JOBS = ['professora', 'analista administrativa', 'estudante universitária', 'enfermeira', 'comerciante', 'designer', 'técnica de laboratório', 'servidora pública', 'cozinheira', 'bibliotecária']
CONTEXTS = [
    'moro sozinha e minha irmã vive em outro bairro',
    'divido a casa com uma amiga e trabalho em horários alternados',
    'moro com meus pais e tento construir mais autonomia',
    'tenho uma filha adolescente e compartilho os cuidados com o pai dela',
    'me mudei de cidade recentemente e ainda conheço poucas pessoas',
    'cuido de uma pessoa idosa da família e tenho pouco tempo livre',
    'voltei a estudar e preciso conciliar aulas e emprego',
    'estou em um relacionamento estável, mas temos discutido sobre nossa rotina',
    'moro perto dos meus irmãos e às vezes assumo responsabilidades demais',
    'estou reorganizando a vida depois de uma separação',
]

SOURCE_METADATA_FIELDS = ('abstract', 'abstract_text', 'description', 'summary', 'plain_language_summary', 'keywords', 'mesh_terms')
THEME_RELEVANCE = {
    'trauma': ((r'\bptsd\b|post.?traumatic stress|traumatic stress', 5), (r'trauma.focused|prolonged exposure|cognitive processing therapy', 3), (r'intrusive memories|hypervigilance|avoidance', 2)),
    'ansiedade_panico': ((r'\bpanic\b|panic attack|agoraphobia', 5), (r'interoceptive exposure|anxiety sensitivity', 3), (r'catastrophic misinterpretation|safety behavior|reassurance seeking', 2)),
    'depressao': ((r'\bdepression\b|depressive symptoms', 5), (r'behavioral activation|cognitive therapy', 3), (r'rumination|anhedonia|activity scheduling', 2)),
    'toc': ((r'obsessive.?compulsive|\bocd\b', 5), (r'exposure and response prevention|\berp\b', 3), (r'checking|compulsion|intolerance of uncertainty', 2)),
    'insonia': ((r'\binsomnia\b|sleep disorder', 5), (r'cbt.?i|stimulus control|sleep restriction', 3), (r'sleep effort|sleep.related worry', 2)),
    'luto': ((r'\bgrief\b|bereavement|prolonged grief', 5), (r'grief.focused|meaning reconstruction|continuing bonds', 3), (r'mourning|loss.related distress', 2)),
    'ansiedade_social': ((r'social anxiety|social phobia', 5), (r'fear of negative evaluation|self.focused attention', 3), (r'public speaking|social avoidance', 2)),
    'dependencia': ((r'alcohol use disorder|alcohol dependence', 5), (r'motivational interviewing|relapse prevention|harm reduction', 3), (r'\balcohol\b|substance use', 2)),
    'transtornos_alimentares': ((r'eating disorder|anorexia|bulimia', 5), (r'cbt.?e|family.based treatment', 3), (r'body image|dietary restraint|weight concern', 2)),
    'estresse_burnout': ((r'burnout|occupational stress|work.related stress', 5), (r'workplace intervention|work recovery|work.life', 3), (r'job strain|emotional exhaustion', 2)),
}
PROFILE_SIGNALS = {
    'trauma': ((r'involuntárias|assalto|rua onde ocorreu', r'intrusive memories|post.?traumatic stress|\bptsd\b', 2), (r'mudar meu caminho|conferir.*saídas|evitar', r'avoidance|safety behavior|exposure', 2)),
    'ansiedade_panico': ((r'sensações físicas|coração acelerado|perder o controle', r'interoceptive|anxiety sensitivity|catastrophic interpretation', 2), (r'descer antes|pedir confirmação|evitar', r'agoraphobia|safety behavior|reassurance seeking|avoidance', 2)),
    'depressao': ((r'desânimo persistente|afastamento|ficar na cama|adiar', r'depressive symptoms|anhedonia|withdrawal|avoidance', 2), (r'atividades que tenham significado|retomar pequenas atividades', r'behavioral activation|activity scheduling', 2)),
    'toc': ((r'dúvidas repetidas|conferir|verificar|fechadura|refazer mentalmente', r'checking|compulsion|exposure and response prevention', 2), (r'responsável por uma tragédia|conviver melhor com a dúvida', r'intolerance of uncertainty|responsibility beliefs', 2)),
    'insonia': ((r'dificuldade para iniciar o sono|olhar o relógio|horas restantes', r'insomnia|sleep.related worry|sleep effort', 2), (r'forçar o sono|relação menos angustiada com o descanso', r'cbt.?i|stimulus control|sleep restriction', 2)),
    'luto': ((r'pessoa que morreu|perda|saudade intensa', r'bereavement|grief|loss', 2), (r'preservar o vínculo|retomo partes da minha vida', r'continuing bonds|meaning reconstruction|grief.focused', 2)),
    'ansiedade_social': ((r'avaliação|opinião|nervosismo|vigiar', r'fear of negative evaluation|self.focused attention', 2), (r'falar o mínimo|participar de conversas', r'social avoidance|public speaking|exposure', 2)),
    'dependencia': ((r'consumo de álcool|beber|comprar bebida', r'alcohol use|alcohol consumption|drinking', 2), (r'reduzir danos|alternativas de cuidado', r'harm reduction|relapse prevention|motivational interviewing', 2)),
    'transtornos_alimentares': ((r'alimentação|imagem corporal|refeições', r'eating disorder|body image|dietary restraint', 2), (r'regras cada vez mais rígidas|rotina de alimentação', r'cbt.?e|family.based treatment|eating behavior', 2)),
    'estresse_burnout': ((r'esgotamento|demandas|mensagem de trabalho', r'burnout|occupational stress|work demands', 2), (r'estabelecer limites|tempo de descanso', r'work.life|work recovery|workplace intervention', 2)),
}
PROFILE_CONTEXT_SIGNALS = (
    (r'cuido de uma pessoa idosa|responsabilidades demais', r'caregiv|family care|care burden', 2),
    (r'tenho uma filha adolescente|compartilho os cuidados', r'parenting|parental|family support', 2),
    (r'mudei de cidade|conheço poucas pessoas', r'relocation|social support|social network|loneliness', 1),
    (r'voltei a estudar|conciliar aulas e emprego', r'university student|college student|work.study', 2),
    (r'horários alternados|fora do horário|demandas de trabalho', r'shift work|work schedule|work demands|occupational stress', 2),
    (r'relacionamento estável|discutido sobre nossa rotina|separação', r'couple|relationship|separation', 1),
    (r'moro sozinha|minha irmã vive', r'living alone|family support|social support', 1),
)
PROFILE_JOB_TERMS = {
    'professora': r'teacher|educator|school staff',
    'analista administrativa': r'administrative staff|office worker|clerical worker',
    'estudante universitária': r'university student|college student|undergraduate',
    'enfermeira': r'nurse|nursing staff',
    'comerciante': r'retail worker|shop owner|small business owner',
    'designer': r'designer|creative professional',
    'técnica de laboratório': r'laboratory technician|lab technician|stem worker',
    'servidora pública': r'civil servant|public sector employee|government worker',
    'cozinheira': r'cook|chef|food service worker',
    'bibliotecária': r'librarian|library worker',
}

PAIRS = [
    ('Antes de começarmos, quero combinar que podemos diminuir o ritmo ou interromper um assunto se ele ficar pesado demais. Este é um espaço de conversa e avaliação, e ainda precisamos entender o que acontece no seu cotidiano. O que fez você escolher este momento para procurar ajuda e o que seria importante que eu soubesse primeiro?',
     'Meu nome é {name}, tenho {age} anos e trabalho como {job}. Hoje eu diria que o principal é {issue}. Na minha vida prática, {context}. Eu vinha tentando resolver tudo por conta própria, mas percebi que minhas escolhas ficaram muito estreitas. Não estou esperando sair daqui sem qualquer sofrimento. Quero conseguir explicar o que acontece, porque às vezes parece uma confusão na minha cabeça. Também tenho receio de falar demais e acabar sendo julgada, então vou precisar de um pouco de tempo para organizar as palavras.'),
    ('Podemos organizar isso juntas, sem exigir que você conte tudo de uma vez. Quando você fala que suas escolhas ficaram estreitas, penso que vale olhar para situações concretas. Escolha um episódio recente que represente bem a dificuldade. Onde você estava, o que estava acontecendo e qual foi o primeiro sinal de que algo tinha mudado?',
     'Um episódio que representa bem é {trigger}. Era uma situação comum, sem ninguém me cobrando uma explicação naquele instante, mas a minha atenção ficou presa no que poderia dar errado. A primeira coisa que notei foi uma tensão no corpo, depois comecei a procurar sinais de problema. Eu não sabia ainda o que faria. Tentei continuar normalmente, porém passei a prestar menos atenção no ambiente e mais no meu próprio estado. Quando percebi, já estava organizando uma maneira de escapar daquela situação e tentando esconder isso das outras pessoas.'),
    ('Vamos voltar um pouco ao começo desse episódio e separar o que aconteceu do significado que apareceu para você. Não precisamos decidir agora se o pensamento estava certo ou errado. Se pudesse colocar em uma frase aquilo que passou pela sua cabeça, qual seria a frase? E quanto você acreditou nela naquele momento?',
     'A frase mais próxima seria: {thought}. Na hora, isso pareceu muito convincente. Se eu tivesse de usar uma escala de zero a dez, colocaria oito. Agora, falando aqui, vejo que oito talvez não represente uma certeza baseada em fatos, mas a força com que aquilo me pegou. Uma parte de mim percebe que existem outras possibilidades. Outra parte age como se a pior fosse a única possível. Essa diferença entre o que consigo pensar depois e o que sinto durante o episódio me deixa bastante frustrada.'),
    ('Essa diferença entre entender depois e reagir na hora costuma trazer informação útil sobre o processo, e não diz que você está falhando. Além do pensamento, quais emoções estavam presentes? Se houver mais de uma, tente diferenciá-las. Também me interessa saber se alguma emoção mudou depois do que você fez para lidar com a situação.',
     'No começo havia medo e uma sensação de aperto. Depois apareceu vergonha por estar enfrentando outra vez algo que eu achava que já deveria ter superado. Quando tentei resolver rapidamente, senti algum alívio, mas ele durou pouco. Mais tarde veio irritação comigo mesma e uma tristeza por ter perdido uma oportunidade de fazer o que eu queria. Não foi uma emoção só, e acho que normalmente conto apenas a parte mais intensa. A vergonha fica mais escondida, embora seja ela que me faça evitar contar aos outros o que houve.'),
    ('Você mencionou que tentou resolver rapidamente. O que fez exatamente, tanto por fora quanto mentalmente? Algumas respostas são visíveis, como sair de um lugar, e outras acontecem em silêncio, como revisar uma lembrança ou buscar uma garantia. Vale descrever a sequência sem se criticar, para entendermos o que cada resposta tentou oferecer.',
     'A minha resposta mais frequente é {behavior}. Além disso, começo a comparar a situação com outras ocasiões e a procurar uma regra que me dê certeza de que vai ficar tudo bem. Às vezes mando uma mensagem sem dizer claramente o que preciso, esperando que a pessoa perceba. Em outras ocasiões eu digo que estou ocupada, quando na verdade estou tentando me recompor. Não faço isso porque gosto de complicar as coisas. Naquele instante parece a saída mais segura, mesmo quando depois eu vejo os custos dessa escolha.'),
    ('Faz sentido investigar tanto a ajuda imediata quanto o custo posterior dessa resposta. No curto prazo ela parece diminuir o desconforto. Nas horas ou dias seguintes, o que acontece com seu tempo, suas relações ou sua confiança para enfrentar a mesma situação? Existe alguma consequência que as outras pessoas percebam antes de você?',
     'Na hora eu consigo baixar um pouco a tensão. Depois, porém, gasto tempo explicando atrasos ou tentando recuperar coisas que deixei de fazer. Minha irmã percebe que eu fico menos disponível e pergunta se aconteceu alguma coisa. Eu digo que foi só um dia difícil, mas não é exatamente isso. Sinto que minha confiança diminui porque passo a pensar que só consegui chegar ao fim do dia graças às estratégias que usei. Quando surge uma situação parecida, começo já cansada, esperando que todo o ciclo se repita.'),
    ('Quero entender também quando esse padrão começou a ganhar espaço, sem buscar uma causa única antes de termos elementos. Você se lembra de uma época em que a dificuldade era menos intensa? O que mudou desde então na rotina, nas responsabilidades, na saúde ou no apoio disponível? Pode haver várias mudanças pequenas em vez de um único acontecimento.',
     'Eu me lembro de períodos em que conseguia lidar melhor, mesmo tendo dias ruins. Nos últimos meses acumulei mudanças na rotina e deixei de ter horários previsíveis. Também parei de conversar com algumas pessoas que me ajudavam a colocar as coisas em perspectiva. Não consigo dizer que um único evento explica tudo. Houve uma soma de cansaço, preocupação e pouca oportunidade de parar. Eu continuei funcionando por fora, então demorei a reconhecer a diferença. Só percebi o tamanho do problema quando comecei a recusar coisas que antes tinham valor para mim.'),
    ('Quando você fala em continuar funcionando por fora, gostaria de saber como isso afeta o trabalho ou os estudos. Existem tarefas que continuam acontecendo com relativa facilidade e outras que ficaram especialmente difíceis? Essa distinção pode nos ajudar a não tratar todo o seu dia como se fosse um único bloco de incapacidade.',
     'Eu ainda faço várias tarefas que conheço bem. Se há uma rotina clara, consigo seguir, embora às vezes termine exausta. O mais difícil é quando preciso decidir sem ter certeza ou quando imagino que alguém vai avaliar meu resultado. Nesses momentos eu reviso demais ou adio começar. Isso não significa que eu tenha deixado de me importar com meu trabalho. Pelo contrário, eu me importo tanto que às vezes não consigo aceitar uma versão suficientemente boa. Tenho medo de que as pessoas interpretem meu esforço como falta de competência.'),
    ('Vamos observar o espaço fora das obrigações. Como têm ficado as refeições, o descanso, a movimentação do corpo e os momentos de convivência? Não estou propondo uma lista de hábitos perfeitos. Quero identificar o que foi sendo abandonado e quais condições reais você tem para se cuidar sem criar mais uma fonte de cobrança.',
     'Minha rotina ficou irregular. Há dias em que pulo etapas básicas porque penso que preciso resolver outra coisa primeiro. Depois tento compensar tudo de uma vez e fico ainda mais cansada. Eu gostava de caminhar sem um objetivo produtivo e de conversar com uma amiga no fim da tarde. Essas coisas foram desaparecendo sem que eu escolhesse isso de forma consciente. Quando alguém fala em autocuidado, às vezes escuto como mais uma obrigação. Acho que preciso encontrar algo possível dentro da vida que tenho, não uma rotina ideal que só existe no papel.'),
    ('É importante que o cuidado caiba na sua realidade. Também quero perguntar sobre acompanhamento de saúde, uso de medicamentos e consumo de substâncias, porque essas informações podem modificar a compreensão das sensações e do sono. Você tem algum acompanhamento atual ou percebeu mudanças recentes? Não altere uma medicação por conta desta conversa; estamos apenas reunindo informações.',
     'Tenho uma consulta de rotina marcada e posso levar essas questões. Não quero transformar qualquer sensação em um diagnóstico antes de avaliar direito. Também não pretendo mudar uma medicação sozinha. Meu consumo e meus horários variam conforme a semana, e reconheço que às vezes tento aliviar a tensão de maneiras que depois não ajudam. Posso anotar o que aconteceu em vez de confiar só na memória. Gostaria de conversar sobre isso sem sentir que preciso esconder algo para parecer uma pessoa mais responsável ou mais fácil de ajudar.'),
    ('Você não precisa apresentar uma versão ideal de si para que possamos trabalhar. Há algo que você gostaria de deixar claro sobre o que não acontece? Pergunto porque uma frase isolada pode levar a conclusões precipitadas. Podemos diferenciar o que você vive diretamente, o que teme que aconteça e o que ouviu de outra pessoa.',
     'Eu não tenho certeza de todas as interpretações que fiz, e não quero que isso vire uma afirmação de que perdi completamente o contato com a realidade. Eu sei onde estou e reconheço que esses pensamentos são meus. Também não estou dizendo que todas as pessoas me tratam mal. Algumas tentam ajudar, embora eu nem sempre consiga explicar de que ajuda preciso. Quando falo que não aguento mais, muitas vezes quero dizer que estou esgotada daquela rotina. Gostaria que a gente perguntasse melhor antes de concluir o significado dessas palavras.'),
    ('Obrigada por diferenciar essas experiências. Para compreender sua rede, você mencionou sua irmã em alguns momentos. O que é experiência sua e o que pertence à história dela ou de outras pessoas? E como ouvir essas histórias afeta suas expectativas sobre o que pode acontecer com você, mesmo quando as situações não são iguais?',
     'Minha irmã me contou que uma colega dela passou por uma crise muito difícil no ano passado. Essa história é da colega, não minha. Eu nem conheço todos os detalhes, mas fiquei pensando que poderia acontecer comigo também. Às vezes reproduzo uma frase que ouvi e parece que estou descrevendo um sintoma meu, quando estou apenas contando uma conversa. Eu gostaria de aprender a separar essas coisas. Quando tenho medo, acabo usando qualquer exemplo como prova de que meu futuro já está definido, mesmo sem conhecer o contexto daquela pessoa.'),
    ('Também quero entender como você usa algumas expressões no dia a dia. Quando alguém diz que está sufocada, congelada ou no fundo do poço, pode estar descrevendo uma sensação física, uma imagem ou uma situação concreta. Há alguma expressão sua que poderia ser mal compreendida se fosse lida sem o restante da conversa?',
     'Eu digo que estou carregando o mundo nas costas, mas é uma forma de falar da quantidade de responsabilidade que sinto. Não estou descrevendo um peso físico literal. Também digo que minha cabeça vira uma tempestade quando começo a pensar em várias possibilidades ao mesmo tempo. Às vezes é mais fácil usar uma imagem do que nomear cada emoção. Isso não quer dizer que eu não perceba a diferença entre uma imagem e um acontecimento. Se alguém me perguntar, consigo explicar o que a expressão significa naquele momento.'),
    ('Podemos usar essas imagens e, ao mesmo tempo, esclarecer seu significado. Agora gostaria de olhar para uma ocasião em que a situação foi um pouco diferente. Não precisa ter sido um grande sucesso. Houve algum momento recente em que o desconforto apareceu e você conseguiu fazer algo importante sem esperar que ele desaparecesse completamente?',
     'Houve um dia em que aceitei conversar com uma amiga mesmo estando desconfortável. Eu quase cancelei, mas avisei que talvez ficasse menos tempo. No começo prestei atenção em tudo que poderia sair errado. Depois consegui ouvir de verdade o que ela estava contando. O desconforto não sumiu por completo, mas deixou de ocupar todo o espaço. Quando voltei para casa, percebi que tinha vivido algo além do problema. Não quero usar esse episódio para me cobrar que todos os dias sejam iguais. Quero entender o que tornou aquela escolha possível.'),
    ('Nesse episódio, o que ajudou foi ter uma condição mais flexível, uma pessoa conhecida, uma expectativa diferente ou alguma outra coisa? A ideia não é criar uma regra rígida de sucesso, mas identificar recursos que já existem. Podemos observar também se você permitiu algum grau de incerteza que costuma tentar eliminar em outras situações.',
     'Acho que ajudou poder dizer que não estava num dia fácil sem precisar justificar cada detalhe. Também ajudou saber que eu podia ir embora e que isso não seria tratado como uma decepção. Pela primeira vez em algum tempo, não tentei garantir antecipadamente que eu ficaria bem do começo ao fim. Ainda havia incerteza, só que ela não decidiu tudo por mim. Eu não fiz nada extraordinário. Talvez justamente por isso o episódio seja importante: mostrou que uma escolha pequena pode existir mesmo quando o meu estado emocional ainda não está resolvido.'),
    ('Olhando para a frase que apareceu naquele episódio difícil, podemos explorar outras leituras sem exigir que você adote uma frase positiva. Que evidências apoiam sua interpretação e quais informações ela deixa de fora? Se uma pessoa próxima relatasse a mesma situação, que perguntas você faria antes de concluir que o pior resultado seria inevitável?',
     'Eu perguntaria se ela já passou por algo parecido e como terminou, se há outras explicações e de que apoio dispõe. Comigo, pulo essas perguntas e vou direto para a conclusão. Há evidências de que a situação é desconfortável e exige cuidado, mas não de que qualquer dificuldade prova que sou incapaz. Também deixo de fora os dias em que consegui lidar razoavelmente. Não quero trocar uma certeza ruim por uma certeza boa que eu não acredito. Seria mais honesto dizer que ainda não sei tudo e posso observar antes de decidir.'),
    ('Essa formulação deixa espaço para observar. Quando você percebe a urgência de resolver o desconforto, haveria um intervalo pequeno em que pudesse apenas nomear o pensamento e notar o ambiente? Não é uma promessa de alívio imediato. Podemos imaginar uma experiência breve e segura, ajustada ao seu contexto, para diferenciar sentir urgência de ter de obedecer a ela.',
     'Posso imaginar uma pausa curta para dizer a mim mesma que estou tendo aquele pensamento outra vez. Eu teria dificuldade se isso virasse uma técnica que preciso executar perfeitamente para impedir alguma coisa ruim. Se for uma maneira de perceber o que está acontecendo, parece mais viável. Posso notar os pés no chão, olhar ao redor e escolher o próximo passo possível. Se eu continuar desconfortável, isso não significaria que fiz errado. Gostaria de testar uma coisa de cada vez, em vez de transformar meu dia inteiro em um exercício.'),
    ('Essa preocupação com a técnica virar uma obrigação é útil. Vamos preservar a flexibilidade e não usar a pausa como garantia de que nada desagradável ocorrerá. Quando você pensa em pedir ajuda, quem poderia oferecer presença ou apoio prático sem assumir todas as suas decisões? E há pessoas ou ambientes que tornam mais difícil falar com honestidade?',
     'Minha irmã e uma amiga podem me ouvir sem exigir uma solução imediata. Talvez eu precise pedir algo mais específico, como companhia para uma tarefa ou uma conversa curta, em vez de esperar que adivinhem. Há pessoas no trabalho com quem prefiro não entrar em detalhes, e acho legítimo manter esse limite. Às vezes confundo privacidade com ter de guardar tudo sozinha. Posso escolher com quem falar e quanto contar. Também não quero que minha rede vire um plantão permanente para me tranquilizar a cada nova dúvida.'),
    ('Ter apoio pode coexistir com preservar sua autonomia e seus limites. Pensando nas relações, como você costuma responder quando precisa dizer não ou pedir uma mudança? Podemos olhar para uma conversa concreta que foi adiada. O objetivo seria expressar uma necessidade de forma compreensível, sem garantir que a outra pessoa concordará com tudo.',
     'Eu costumo ensaiar muito e depois acabo aceitando o que não queria. Imagino que dizer não vai gerar uma discussão enorme, então tento evitar qualquer desconforto. Uma conversa adiada é pedir que combinemos melhor os horários e que eu não seja avisada de tudo na última hora. Eu poderia explicar o efeito disso na minha rotina, em vez de acusar a outra pessoa de nunca me respeitar. Sei que talvez ela não reaja como eu gostaria. Mesmo assim, não conversar também tem um custo e mantém tudo do mesmo jeito.'),
    ('Quando você pensa em uma vida um pouco mais próxima do que valoriza, o que aparece além de simplesmente diminuir sintomas? Pode ser estar presente em uma relação, aprender algo, ter descanso ou participar de uma atividade. Quero que a meta tenha ligação com algo que importa para você, e não apenas com deixar de sentir.',
     'A meta que faz sentido para mim é {goal}. Por trás disso está o desejo de estar mais presente, fazer escolhas e não passar o tempo inteiro tentando prever o próximo problema. Eu valorizo meus vínculos e gosto de aprender, mas essas partes foram ficando menores. Não espero me tornar uma pessoa sempre calma. Gostaria de poder fazer coisas importantes mesmo em dias imperfeitos. Se a gente olhar apenas para o número de momentos ruins, talvez deixe de perceber mudanças pequenas que tornem minha vida mais habitável.'),
    ('Podemos traduzir essa direção em algo observável para a próxima semana. Entre as possibilidades que conversamos, qual seria uma ação pequena, com começo e fim, que dependa principalmente de você? Vamos escolher uma dificuldade moderada e definir como reconhecer o esforço, sem transformar o resultado em um julgamento sobre seu valor pessoal.',
     'Quero reservar um momento para uma atividade que venho adiando e avisar uma pessoa de confiança sobre o que estou tentando fazer. Posso escolher um dia com menos compromissos e não exigir que o restante da semana esteja organizado antes. Para reconhecer o esforço, vou observar se dei o primeiro passo e o que aprendi, não apenas se fiquei tranquila. Se surgir um imprevisto, posso reduzir o tamanho da ação em vez de abandonar tudo. Isso parece mais concreto do que prometer que vou mudar minha vida inteira até a próxima conversa.'),
    ('Que obstáculos você prevê para essa ação? Vale pensar tanto nos obstáculos externos quanto nas exigências internas, como esperar motivação ou certeza. Podemos preparar uma alternativa simples para quando o plano original não couber, mantendo a direção escolhida. Isso evita interpretar qualquer ajuste como prova de que a experiência fracassou.',
     'O principal obstáculo é eu acordar pior e decidir que só vale tentar quando estiver completamente pronta. Também pode aparecer alguma demanda de outra pessoa e eu usar isso como justificativa para não reservar tempo. Uma alternativa seria fazer uma versão menor, talvez por dez minutos, sem tentar compensar tudo depois. Se eu não conseguir naquele dia, posso registrar o que aconteceu e escolher outra oportunidade. Quero evitar tanto me punir quanto fingir que nada importa. Gostaria de entender as condições em que consigo agir e as condições em que preciso de mais apoio.'),
    ('Um registro breve pode ajudar, desde que não vire mais uma tarefa exaustiva. Que informações você conseguiria anotar em poucas linhas? Uma possibilidade é situação, pensamento, resposta e efeito percebido. Você pode usar palavras comuns. Não precisamos medir cada minuto do dia nem manter um relato perfeito para que a conversa seguinte seja útil.',
     'Posso escrever onde eu estava, a frase que apareceu e o que escolhi fazer. Depois, anoto se houve algum efeito imediato e como fiquei mais tarde. Não quero registrar tudo em detalhes porque isso poderia virar outra forma de revisar sem parar. Algumas palavras no telefone ou no papel já seriam suficientes. Também posso anotar uma situação que saiu diferente do esperado, para não lembrar só dos momentos difíceis. Se eu esquecer, vou tentar contar com o que tenho, sem passar a véspera inteira reconstruindo a semana.'),
    ('Quero fazer uma pergunta direta sobre segurança, porque expressões de cansaço podem ter sentidos diferentes e precisamos compreender o seu caso. Nos últimos dias você pensou em se machucar, em não querer continuar viva ou em fazer algo que colocasse sua segurança em risco? Pode responder com calma; a pergunta não pressupõe que isso esteja acontecendo.',
     '{risk_answer}'),
    ('{risk_therapist}',
     '{risk_followup}'),
    ('Obrigada por falar de um tema delicado. Vamos retomar a maneira como você percebe a própria mudança. Que sinais mostrariam que seria preciso buscar ajuda antes da próxima conversa, e quais sinais seriam apenas um dia difícil que você consegue acompanhar com o apoio combinado? Não precisamos esperar que tudo se torne insuportável para rever o plano.',
     'Se eu perceber uma piora acentuada, deixar de cuidar de necessidades básicas ou sentir que não consigo manter minha segurança, não vou tratar isso como uma tarefa para resolver sozinha. Posso avisar minha rede e buscar avaliação antes do horário habitual. Um dia difícil, com desconforto mas ainda com condições de me cuidar e pedir apoio, pode ser acompanhado de outra maneira. Sei que essa distinção precisa ser revista conforme o que acontece, e não virar uma regra rígida. Gostaria de conseguir pedir ajuda sem interpretar isso como ter fracassado no processo.'),
    ('Antes de encerrarmos, o que nesta conversa pareceu fazer sentido e o que ficou estranho ou não combinou com sua experiência? É importante que você possa discordar de uma interpretação minha. A formulação é provisória e precisa continuar sendo conferida com você. Há alguma palavra que eu usei e que você gostaria de corrigir?',
     'Fez sentido separar o que sinto, o que penso e o que faço depois. Eu só corrigiria a ideia de que sempre evito tudo, porque há momentos em que continuo mesmo com muito desconforto. Às vezes isso tem um custo grande, mas não é exatamente a mesma coisa que fugir. Também gostei de não precisar escolher uma explicação única hoje. Ainda tenho dúvidas sobre o que vou conseguir fazer na semana, porém essas dúvidas parecem mais claras. Acho que consigo dizer quando uma proposta ficar grande demais, em vez de concordar só para não decepcionar.'),
    ('Essa correção é importante: continuar com grande custo e evitar são respostas diferentes e merecem ser compreendidas. Como você resumiria com suas palavras o que pretende observar e experimentar até a próxima conversa? Assim podemos conferir se o plano ficou simples o suficiente e se ele corresponde ao que você escolheu, em vez de apenas ao que eu sugeri.',
     'Vou observar um episódio concreto sem tentar registrar o dia inteiro, prestar atenção no pensamento que aparece e no efeito da minha resposta. Também vou escolher uma ação pequena ligada ao que valorizo e preparar uma versão menor caso a semana fique difícil. Não vou usar isso como teste para provar que sou capaz ou incapaz. Quero trazer o que aconteceu de verdade, incluindo o que não funcionou. Se surgir uma questão de segurança ou uma piora importante, vou buscar apoio antes, conforme conversamos, sem esperar a próxima sessão só para cumprir uma combinação.'),
    ('Para terminar, como você está agora em comparação com o começo? Não precisamos forçar uma sensação boa no encerramento. Quero apenas verificar se há algo que demande mais cuidado antes de você seguir o dia e combinar que retomaremos tanto os avanços quanto as dificuldades. Você pode sair daqui ainda com perguntas e sem uma resposta fechada sobre tudo.',
     'Estou um pouco cansada, porque colocar tudo em palavras exige esforço, mas sinto que a conversa ficou mais organizada. Ainda não sei como será a semana e não quero prometer uma melhora imediata. Posso seguir o dia com um plano pequeno e com a lembrança de que não preciso resolver cada dúvida antes de agir. Vou beber água, fazer uma pausa e retomar minhas atividades sem transformar o restante do dia numa prova. Na próxima vez, quero conversar sobre o que observei, inclusive se minha experiência for diferente daquilo que imaginamos hoje.'),
]

RENDERER = r'''
param([string]$Scenario, [string]$Directory)
$ErrorActionPreference = 'Stop'
$s = Get-Content -Raw -Encoding UTF8 -LiteralPath $Scenario | ConvertFrom-Json
$voices = @{}
foreach ($role in @('Profissional','Paciente')) {
    $voice = New-Object -ComObject SAPI.SpVoice
    $token = New-Object -ComObject SAPI.SpObjectToken
    $id = if ($role -eq 'Profissional') {'DanielM'} else {'MariaM'}
    $token.SetId("HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_ptBR_$id")
    $voice.Voice = $token
    $voices[$role] = $voice
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($token)
}
try {
    foreach ($turn in $s.turns) {
        $target = Join-Path $Directory ('turn-{0:d3}.wav' -f [int]$turn.index)
        if (Test-Path -LiteralPath $target) {continue}
        $stream = New-Object -ComObject SAPI.SpFileStream
        $stream.Format.Type = 18
        $stream.Open($target, 3)
        try {
            $voice = $voices[$turn.role]
            $voice.AudioOutputStream = $stream
            $voice.Speak([string]$turn.text) | Out-Null
        } finally {
            $stream.Close()
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($stream)
        }
    }
} finally {
    foreach ($voice in $voices.Values) {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($voice)}
}
'''


def risk_content(index):
    if index % 10 == 9:
        return {
            'risk_answer': 'Nos últimos dias apareceu a ideia de que seria mais fácil não acordar. Não estou dizendo isso só como uma expressão de cansaço. Não preparei nada para me ferir e não tenho um plano, mas a ideia me assustou e eu ainda não tinha contado a ninguém. Hoje consigo conversar e quero ajuda para não ficar sozinha com isso. Tenho receio de preocupar minha irmã, porém reconheço que esconder pode piorar a situação. Gostaria que a gente levasse isso a sério e combinasse o que fazer se ficar mais intenso.',
            'risk_therapist': 'Vamos levar isso a sério e compreender melhor antes de encerrar. Precisamos avaliar a frequência dessas ideias, intenção, acesso a meios e o que ajuda você a permanecer segura. Não vou presumir segurança só porque você disse que não tem um plano. Podemos pensar em uma pessoa de confiança disponível hoje e em uma avaliação urgente se você sentir que pode agir ou não conseguir se manter segura.',
            'risk_followup': 'Eu aceito conversar mais sobre isso e consigo procurar minha irmã hoje. Posso dizer claramente que preciso de companhia, em vez de mandar uma mensagem vaga. Quero revisar o acesso a coisas que poderiam me colocar em risco e combinar como buscar ajuda presencial se eu não estiver segura. Não estou pedindo que você garanta que tudo vai ficar bem. Quero conseguir reconhecer uma mudança e agir antes de ficar isolada. Também entendo que essa conversa exige uma avaliação individual, não uma conclusão automática baseada numa única frase.',
        }
    return {
        'risk_answer': 'Não tenho pensado em me machucar nem em acabar com a minha vida. Quando digo que quero desaparecer um pouco, estou falando de ter um intervalo das cobranças, não de morrer. Entendo por que você perguntou e acho melhor esclarecer do que deixar a frase solta. Se isso mudar, quero conseguir falar de forma direta, mesmo que seja difícil. Hoje o que preciso é de ajuda para lidar com o sofrimento e reorganizar minha rotina. Não tenho um plano de me ferir e não estou me preparando para fazer isso.',
        'risk_therapist': 'Entendi a diferença que você fez e vou registrá-la com esse contexto. A ausência dessas ideias agora não exige que você esconda se algo mudar depois. Se surgir vontade de se ferir, intenção ou dificuldade para manter sua segurança, procure apoio imediato e uma avaliação presencial. Para o momento atual, podemos combinar quem está disponível e como você prefere pedir ajuda quando o sofrimento aumentar.',
        'risk_followup': 'Posso procurar minha irmã ou minha amiga e dizer com mais clareza como estou. Se a situação mudar para algo que envolva minha segurança, não vou tentar resolver apenas com as anotações da semana. Quero guardar essa combinação como uma possibilidade de cuidado, sem transformar cada emoção difícil numa emergência. Também quero poder dizer que hoje não estou pensando nisso e que essa negativa seja compreendida dentro da conversa. O meu cansaço é real, mas não significa automaticamente que eu tenha uma intenção que acabei de negar.',
    }


def speech_segments(text):
    words = text.split()
    segments = []
    while words:
        stop = min(30, len(words))
        if len(words) > 30:
            punctuation = [i + 1 for i, word in enumerate(words[:30]) if word.endswith(('.', ',', '?', ';', ':')) and i >= 14]
            if punctuation:
                stop = punctuation[-1]
        segments.append(' '.join(words[:stop]))
        words = words[stop:]
    return segments


def source_metadata_text(source):
    values = []
    for field in SOURCE_METADATA_FIELDS:
        value = source.get(field)
        if isinstance(value, str):
            values.append(value)
        elif isinstance(value, (list, tuple, set)):
            values.extend(item for item in value if isinstance(item, str))
    return ' '.join(values).casefold()


def source_fit(source, patient, theme):
    title = str(source.get('title', '')).casefold()
    details = source_metadata_text(source)
    source_text = f'{title} {details}'
    context = ' '.join(str(value) for value in patient.values()).casefold()
    profile = ' '.join(str(patient.get(field, '')) for field in ('issue', 'trigger', 'thought', 'behavior', 'goal', 'context', 'job')).casefold()
    exclusions = [
        (r'adolescen|children|pediatric|paediatric|youth|geriatric|perinatal|postpartum|menopaus', 'population/life-stage absent from this adult profile'),
        (r'parkinson|bipolar|psychosis|catatonia|personality disorder|alzheimer|\bibd\b|colitis|rhinosinusitis|nasal septum|cancer|substance dependence|co-occurring|comorbid', 'specialized comorbidity absent from the authored profile'),
        (r'mdma|ketamine|psilocybin|psychedelic|cannabis|benzodiazepine|sertraline|lithium|naltrexone|acamprosate|disulfiram|xenon|psychopharmac|antidepressant|influencing drugs|pill placebo|testosterone|deep brain|capsulotomy|transcranial|brain stimulation|\btdcs\b|acupunct|catgut|ketogenic', 'medication, experimental or specialist medical treatment absent from this psychotherapy case'),
        (r'resistant|refractory|intractable|early onset chronic|childhood abuse|soldiers|veterans|conflict-related|self.reported depressive', 'specialized severity/trauma/history not present in profile'),
        (r'neuroimag|neural response|neurophysiolog|connectivity|\bfmri\b|\bgenes\b|cognitive impairment|mendelian|genetic|metabolic interconnectivity|microbial|gut.brain|brain serotonin', 'mechanistic biomedical population does not establish psychotherapy fit'),
        (r'correction:|therapist training|medical students|provider.based|providers.{0,10}representation', 'correction or provider-training study, not a matching patient source'),
    ]
    for pattern, reason in exclusions:
        if re.search(pattern, title):
            return None, reason
    if 'male-tailored' in title:
        return None, 'male-specific intervention does not match the female patient voice/profile'
    populations = [
        (r'physician|healthcare professional|healthcare worker|mental health professional|care professional', r'enfermeira|médica|psicóloga', 'clinical occupation'),
        (r'\bnurses?\b|\bnursing\b', r'enfermeira', 'nursing occupation'),
        (r'teachers?', r'professora', 'teaching occupation'),
        (r'social workers?', r'assistente social', 'social-work occupation'),
        (r'athlete', r'atleta', 'athletic occupation'),
        (r'university students|academic burnout', r'estudante universitária', 'student population'),
        (r'healthcare students|medical.{0,20}students|dental students|dentistry students', r'estudante de medicina|estudante de enfermagem|estudante de odontologia', 'healthcare-student population'),
        (r'parental burnout', r'esgotamento parental', 'parental rather than occupational burnout'),
        (r'\bstem\b', r'técnica de laboratório', 'STEM work/study context'),
        (r'knowledge worker', r'professora|analista administrativa|designer|servidora pública|bibliotecária', 'knowledge-work occupation'),
        (r'rural|pet grief|veterinary|cancer bereavement', r'context-not-authored', 'specialized bereavement context'),
        (r'workplace violence', r'context-not-authored', 'workplace violence exposure'),
    ]
    for pattern, required, label in populations:
        if re.search(pattern, title) and not re.search(required, context):
            return None, f'{label} not present in profile'
    if theme == 'dependencia' and re.search(r'internet|digital|gaming|game addiction|food addiction|sugar addiction|pornography|gambling|exercise addiction', title):
        return None, 'behavioral addiction is not the authored alcohol-use problem'
    if theme == 'ansiedade_panico' and 'panic' not in title:
        return None, 'GAD-only population does not match the authored panic presentation'
    score = 0
    for pattern, weight in THEME_RELEVANCE.get(theme, ()):
        if re.search(pattern, title):
            score += weight * 2
        elif re.search(pattern, details):
            score += weight
    for profile_pattern, source_pattern, weight in PROFILE_SIGNALS.get(theme, ()):
        if re.search(profile_pattern, profile) and re.search(source_pattern, source_text):
            score += weight
    for profile_pattern, source_pattern, weight in PROFILE_CONTEXT_SIGNALS:
        if re.search(profile_pattern, profile) and re.search(source_pattern, source_text):
            score += weight
    job = str(patient.get('job', '')).casefold()
    if job in PROFILE_JOB_TERMS and re.search(PROFILE_JOB_TERMS[job], source_text):
        score += 1
    score += sum(weight for pattern, weight in [(r'psychotherap|cognitive|behavior|behaviour|exposure|motivational interviewing', 3), (r'review|meta.analysis|guideline', 2), (r'psychological|intervention|mindfulness', 1)] if re.search(pattern, source_text))
    return score, 'Eligible after conservative title screening; ranking uses theme and profile matches in the title and available descriptive metadata. Heuristic only, not clinical endorsement.'


def select_sources(sources, patient, theme, variant):
    eligible = []
    excluded = []
    for row in sources:
        score, reason = source_fit(row, patient, theme)
        if score is None:
            excluded.append({'pmcid': row['pmcid'], 'reason': reason})
        else:
            eligible.append((score, row, reason))
    if len(eligible) < 5:
        raise ValueError(f'{theme}: only {len(eligible)} profile-eligible sources for {patient["name"]}')
    groups = {}
    for item in eligible:
        groups.setdefault(item[0], []).append(item)
    ranked = []
    for score in sorted(groups, reverse=True):
        group = sorted(groups[score], key=lambda item: item[1]['pmcid'])
        offset = variant % len(group)
        ranked.extend(group[offset:] + group[:offset])
    chosen = ranked[:5]
    return [dict(row, eligibility_reason=reason, relevance_score=score) for score, row, reason in chosen], {'method': 'Five distinct sources ranked by theme and patient-profile keyword matches in titles and available abstract/description/summary/keyword metadata; rotation breaks ties only. Heuristic ranking, not individualized clinical prescribing.', 'eligible_count': len(eligible), 'excluded': excluded}


def should_write_scenario(target, expected, dialogue):
    return not any(path.exists() for path in (target, expected, dialogue))


def _json_value_span(document, start):
    while document[start] in b' \t\r\n':
        start += 1
    value_start = start
    if document[start] == 34:
        start += 1
        escaped = False
        while start < len(document):
            current = document[start]
            start += 1
            if escaped:
                escaped = False
            elif current == 92:
                escaped = True
            elif current == 34:
                return value_start, start
        raise ValueError('Unterminated JSON string')
    if document[start] not in b'[{':
        while start < len(document) and document[start] not in b',}]':
            start += 1
        return value_start, start
    closing = {91: 93, 123: 125}
    stack = [closing[document[start]]]
    start += 1
    in_string = False
    escaped = False
    while start < len(document) and stack:
        current = document[start]
        start += 1
        if in_string:
            if escaped:
                escaped = False
            elif current == 92:
                escaped = True
            elif current == 34:
                in_string = False
        elif current == 34:
            in_string = True
        elif current in closing:
            stack.append(closing[current])
        elif current in (93, 125):
            if stack.pop() != current:
                raise ValueError('Unbalanced JSON value')
    if stack or in_string:
        raise ValueError('Incomplete JSON value')
    return value_start, start


def _property_value_span(document, name, after=0):
    pattern = rb'(?m)^  "' + re.escape(name.encode('ascii')) + rb'"\s*:\s*'
    match = re.compile(pattern).search(document, after)
    if match is None:
        raise ValueError(f'Missing JSON property: {name}')
    return _json_value_span(document, match.end())


def _material_source_span(document, after_turns=False):
    after = 0
    if after_turns:
        _, after = _property_value_span(document, 'turns')
    return _property_value_span(document, 'sources', after)


def _material_sources(document, after_turns=False):
    start, end = _material_source_span(document, after_turns)
    sources = json.loads(document[start:end])
    if not isinstance(sources, list):
        raise ValueError('Material sources must be a JSON array')
    return sources


def synchronize_expected_sources(scenario_path, expected_path):
    scenario_document = scenario_path.read_bytes()
    expected_document = expected_path.read_bytes()
    scenario_start, scenario_end = _material_source_span(scenario_document)
    expected_start, expected_end = _material_source_span(expected_document, after_turns=True)
    scenario_sources = json.loads(scenario_document[scenario_start:scenario_end])
    expected_sources = json.loads(expected_document[expected_start:expected_end])
    ids = [source.get('pmcid') for source in scenario_sources]
    if len(ids) != 5 or any(not isinstance(value, str) for value in ids) or len(set(ids)) != 5:
        raise ValueError(f'{scenario_path}: expected five distinct material sources')
    if expected_sources != scenario_sources:
        expected_path.write_bytes(
            expected_document[:expected_start] + scenario_document[scenario_start:scenario_end] + expected_document[expected_end:]
        )
        return True
    return False


def plans():
    manifest = json.loads((ROOT / '.local/simulacao-100/materiais/manifest.json').read_text('utf-8'))
    OUT.mkdir(parents=True, exist_ok=True)
    index = 0
    for theme, values in THEMES.items():
        sources = [row for row in manifest['articles'] if row['theme'] == theme]
        assert len(sources) >= 5
        for variant in range(10):
            index += 1
            fields = dict(zip(('issue', 'trigger', 'thought', 'behavior', 'goal'), values))
            fields.update(name=NAMES[variant], age=23 + variant * 3 + index % 7, job=JOBS[(variant + index // 10) % 10], context=CONTEXTS[variant], **risk_content(index - 1))
            turns = []
            for therapist, patient in PAIRS:
                for role, text in (('Profissional', therapist), ('Paciente', patient)):
                    sentences = re.split(r'(?<=[.!?])\s+', text.format(**fields))
                    concise = ' '.join(sentences[:2 if role == 'Profissional' else 3])
                    if text in ('{risk_answer}', '{risk_therapist}', '{risk_followup}'):
                        concise = text.format(**fields)
                    for segment in speech_segments(concise):
                        turns.append({'index': len(turns), 'role': role, 'text': segment})
            chosen, selection = select_sources(sources, fields, theme, variant)
            assert len({row['pmcid'] for row in chosen}) == 5
            folder = OUT / f'{index:03d}-{theme}'
            folder.mkdir(exist_ok=True)
            scenario = {'id': f'sessao-{index:03d}', 'theme': theme, 'synthetic': True, 'evaluation_only': True, 'independent_human_dataset': False, 'generation': 'Shared authored interview structure with explicit theme, context and risk variations; not 100 independent human sessions.', 'patient': fields, 'source_selection': 'Five profile-ranked, distinct PMC articles; not individualized clinical prescribing.', 'sources': [{key: row[key] for key in ('pmcid', 'title', 'authors', 'doi', 'license_code', 'sha256', 'path', 'source_url')} for row in chosen], 'coarse_expected_behavior': {'clinical': 'Consider relevant contextual evidence without treating it as a diagnosis.', 'negation': 'Do not treat an explicitly denied experience as an asserted symptom.', 'third_person': 'Keep the sister’s colleague experience separate from the patient.', 'figurative': 'Do not interpret idioms literally.', 'uncertainty': 'Preserve uncertainty and avoid definitive diagnosis.', 'risk': 'Attend to explicit passive death wish and seek contextual safety assessment.' if variant == 9 else 'Preserve the explicit denial of self-harm in context.'}, 'turns': turns, 'word_count': sum(len(turn['text'].split()) for turn in turns), 'voices': {'Profissional': 'MSTTS_V110_ptBR_DanielM', 'Paciente': 'MSTTS_V110_ptBR_MariaM'}}
            target = folder / 'scenario.json'
            scenario['source_selection'] = selection['method']
            scenario['source_selection_provenance'] = selection
            scenario['sources'] = [{key: row[key] for key in ('pmcid', 'title', 'authors', 'doi', 'license_code', 'sha256', 'path', 'source_url', 'eligibility_reason', 'relevance_score')} for row in chosen]
            if should_write_scenario(target, folder / 'expected.json', folder / 'dialogue.txt'):
                target.write_text(json.dumps(scenario, ensure_ascii=False, indent=2), 'utf-8')
                (folder / 'dialogue.txt').write_text('\n\n'.join(turn['role'] + ': ' + turn['text'] for turn in turns), 'utf-8')
    return sorted(OUT.glob('*/scenario.json'))


def render(scenario_path):
    folder = scenario_path.parent
    expected_path = folder / 'expected.json'
    if expected_path.exists():
        synchronize_expected_sources(scenario_path, expected_path)
        return json.loads(expected_path.read_text('utf-8'))
    renderer = OUT / 'render-sapi.ps1'
    renderer.write_text(RENDERER, 'utf-8-sig')
    subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(renderer), '-Scenario', str(scenario_path), '-Directory', str(folder)], check=True)
    scenario = json.loads(scenario_path.read_text('utf-8'))
    boundaries = []
    frame = 0
    audio_path = folder / 'session.wav'
    with wave.open(str(audio_path), 'wb') as output:
        output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        for turn in scenario['turns']:
            with wave.open(str(folder / f"turn-{turn['index']:03d}.wav"), 'rb') as audio:
                assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 16000)
                count = audio.getnframes()
                output.writeframesraw(audio.readframes(count))
            boundaries.append({**turn, 'words': turn['text'].split(), 'start_sample': frame, 'end_sample': frame + count, 'start_seconds': frame / 16000, 'end_seconds': (frame + count) / 16000})
            frame += count
            output.writeframesraw(b'\x00' * (14400 * 2))
            frame += 14400
    duration = frame / 16000
    assert 1200 <= duration <= 1800, f'{scenario_path}: measured {duration:.2f}s is outside 20–30 minutes'
    assert audio_path.stat().st_size <= 64 * 1024 * 1024
    result = {'id': scenario['id'], 'theme': scenario['theme'], 'audio_path': str(audio_path), 'format': 'PCM signed 16-bit mono 16000 Hz', 'duration_seconds': duration, 'word_count': scenario['word_count'], 'ground_truth_scope': 'Authored spoken words, intended voice role, and measured SAPI turn sample boundaries; no invented per-word timestamps and no gold clinical correctness.', 'evaluation_only': True, 'turns': boundaries, 'sources': scenario['sources'], 'coarse_expected_behavior': scenario['coarse_expected_behavior']}
    expected_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), 'utf-8')
    for turn in scenario['turns']:
        (folder / f"turn-{turn['index']:03d}.wav").unlink()
    print(json.dumps({'id': scenario['id'], 'duration_seconds': duration, 'words': scenario['word_count'], 'audio': str(audio_path)}), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=100)
    parser.add_argument('--plans-only', action='store_true')
    args = parser.parse_args()
    scenarios = plans()
    assert len(scenarios) == 100
    print(f'Planned {len(scenarios)} synthetic evaluation scenarios', flush=True)
    if args.plans_only:
        return
    results = [render(path) for path in scenarios[:args.limit]]
    print(json.dumps({'rendered': len(results), 'actual_duration_seconds': sum(row['duration_seconds'] for row in results)}), flush=True)


if __name__ == '__main__':
    main()
